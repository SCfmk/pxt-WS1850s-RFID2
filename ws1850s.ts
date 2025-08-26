//% weight=100 color=#0fbc11 icon="\uf2c2"
//% block="RFID2 (WS1850S)"
namespace rfid2 {
    // I2C 7-bit address for M5 RFID2 (WS1850S)
    let I2C_ADDR = 0x28

    // --- MFRC522/PN512 compatible registers (subset) ---
    const CommandReg       = 0x01
    const ComIEnReg        = 0x02
    const DivIEnReg        = 0x03
    const ComIrqReg        = 0x04
    const DivIrqReg        = 0x05
    const ErrorReg         = 0x06
    const Status1Reg       = 0x07
    const Status2Reg       = 0x08
    const FIFODataReg      = 0x09
    const FIFOLevelReg     = 0x0A
    const ControlReg       = 0x0C
    const BitFramingReg    = 0x0D
    const ModeReg          = 0x11
    const TxModeReg        = 0x12
    const RxModeReg        = 0x13
    const TxControlReg     = 0x14
    const TxASKReg         = 0x15
    const CRCResultRegH    = 0x21
    const CRCResultRegL    = 0x22
    const TModeReg         = 0x2A
    const TPrescalerReg    = 0x2B
    const TReloadRegH      = 0x2C
    const TReloadRegL      = 0x2D
    const VersionReg       = 0x37

    // --- Commands ---
    const PCD_Idle         = 0x00
    const PCD_CalcCRC      = 0x03
    const PCD_Transmit     = 0x04
    const PCD_Receive      = 0x08
    const PCD_Transceive   = 0x0C
    const PCD_MFAuthent    = 0x0E
    const PCD_SoftReset    = 0x0F

    // PICC (card) commands
    const PICC_REQA        = 0x26
    const PICC_WUPA        = 0x52
    const PICC_SEL_CL1     = 0x93
    const PICC_SEL_CL2     = 0x95
    const PICC_SEL_CL3     = 0x97
    const PICC_ANTICOLL_CL1= 0x20

    let _initialized = false

    // --- Low-level I2C helpers ---
    function writeReg(reg: number, value: number) {
        const b = pins.createBuffer(2)
        b[0] = reg & 0xFF
        b[1] = value & 0xFF
        pins.i2cWriteBuffer(I2C_ADDR, b)
    }

    function readReg(reg: number): number {
        pins.i2cWriteNumber(I2C_ADDR, reg & 0xFF, NumberFormat.UInt8BE, true)
        return pins.i2cReadNumber(I2C_ADDR, NumberFormat.UInt8BE)
    }

    function setBitMask(reg: number, mask: number) {
        writeReg(reg, readReg(reg) | mask)
    }
    function clearBitMask(reg: number, mask: number) {
        writeReg(reg, readReg(reg) & (~mask))
    }

    function flushFIFO() {
        // FIFOLevelReg bit7 = FlushBuffer
        setBitMask(FIFOLevelReg, 0x80)
    }

    function softReset() {
        writeReg(CommandReg, PCD_SoftReset)
        basic.pause(50)
        // Wait for PowerDown cleared if needed (Status1Reg bit4 = TRunning)
        let t = control.millis()
        while ((readReg(CommandReg) & 0x10) && control.millis() - t < 100) { basic.pause(1) }
    }

    function antennaOn() {
        // TxControl bits 0..1 control antenna drivers, set to 11b to turn on
        let val = readReg(TxControlReg)
        if ((val & 0x03) !== 0x03) {
            setBitMask(TxControlReg, 0x03)
        }
    }

    function calcCRC(data: number[]): number[] {
        flushFIFO()
        // Write data into FIFO
        for (let d of data) writeReg(FIFODataReg, d)
        writeReg(CommandReg, PCD_CalcCRC)

        // Wait for CRCIRq (DivIrqReg bit2)
        let start = control.millis()
        while (true) {
            const n = readReg(DivIrqReg)
            if (n & 0x04) break
            if (control.millis() - start > 25) break
        }
        const crcL = readReg(CRCResultRegL)
        const crcH = readReg(CRCResultRegH)
        return [crcH, crcL]
    }

    function transceive(send: number[], validBits: number): { ok: boolean, data: number[], validBits: number } {
        writeReg(CommandReg, PCD_Idle)
        // Clear IRQs
        writeReg(ComIrqReg, 0x7F)
        flushFIFO()
        // Fill FIFO
        for (let d of send) writeReg(FIFODataReg, d)
        // BitFraming: startSend=0, RxAlign=0, TxLastBits=validBits(0..7)
        writeReg(BitFramingReg, validBits & 0x07)

        // Start Transceive
        writeReg(CommandReg, PCD_Transceive)
        // StartSend bit7
        setBitMask(BitFramingReg, 0x80)

        // Wait for RxIRq or IdleIRq or timeout
        let start = control.millis()
        while (true) {
            const irq = readReg(ComIrqReg)
            if (irq & 0x30) break // RxIRq(0x20) or IdleIrq(0x01)
            if (control.millis() - start > 30) {
                clearBitMask(BitFramingReg, 0x80)
                return { ok: false, data: [], validBits: 0 }
            }
        }

        // Check errors
        const err = readReg(ErrorReg)
        if (err & 0x13) { // BufferOvfl, ParityErr, ProtocolErr
            return { ok: false, data: [], validBits: 0 }
        }

        // Read received data
        const n = readReg(FIFOLevelReg) & 0x7F
        const result: number[] = []
        for (let i = 0; i < n; i++) result.push(readReg(FIFODataReg))
        // Get last received bits
        const lastBits = readReg(ControlReg) & 0x07
        return { ok: true, data: result, validBits: lastBits }
    }

    function requestA(): { ok: boolean, atqa: number[] } {
        // REQA is 7-bit, so set TxLastBits=7
        writeReg(BitFramingReg, 0x07)
        const r = transceive([PICC_REQA], 7)
        // Restore default TxLastBits=0
        writeReg(BitFramingReg, 0x00)
        if (!r.ok || r.data.length < 2) return { ok: false, atqa: [] }
        return { ok: true, atqa: r.data.slice(0, 2) }
    }

    function anticollSelectCL1(): { ok: boolean, uid: number[], sak: number } {
        // Anticollision CL1: 0x93 0x20
        writeReg(BitFramingReg, 0x00)
        let r = transceive([PICC_SEL_CL1, PICC_ANTICOLL_CL1], 0)
        if (!r.ok || r.data.length < 5) return { ok: false, uid: [], sak: 0 }
        const uid0_4 = r.data.slice(0, 5) // 4 UID bytes + BCC

        // SELECT CL1: 0x93 0x70 + (UID0..3 + BCC) + CRC_A
        const sel: number[] = [PICC_SEL_CL1, 0x70].concat(uid0_4)
        const crc = calcCRC(sel)
        sel.push(crc[0], crc[1])
        r = transceive(sel, 0) // expect SAK (1 byte + CRC_A usually)
        if (!r.ok || r.data.length < 1) return { ok: false, uid: [], sak: 0 }
        const sak = r.data[0]
        // If cascade bit set, further levels exist (not handled here)
        return { ok: true, uid: uid0_4.slice(0, 4), sak: sak }
    }

    function toHex(bytes: number[]): string {
        let s = ""
        for (let b of bytes) {
            let h = b.toString(16)
            if (h.length < 2) h = "0" + h
            s += h
        }
        return s
    }

//    //% blockId=rfid2_init block="init RFID2 at I²C address %addr"
//    //% addr.defl=0x28
//    export function init(addr: number = 0x28): void {
//        I2C_ADDR = addr & 0x7F
//        softReset()

        // Timer + mode setup (standard values used for MFRC522/PN512)
//        writeReg(TModeReg, 0x80)
//        writeReg(TPrescalerReg, 0xA9)
//        writeReg(TReloadRegL, 0xE8)
//        writeReg(TReloadRegH, 0x03)
//        writeReg(TxASKReg, 0x40) // 100% ASK
//        writeReg(ModeReg, 0x3D)  // CRC preset 0x6363

//        antennaOn()
//        _initialized = true
//    }
    /* RENAME: tidl. init(addr:number=0x28) -> initRaw(...) og skjul i Blocks */
    //% blockId=rfid2_init_raw blockHidden=true
    export function initRaw(addr: number = DEFAULT_ADDR): void {
        I2C_ADDR = addr & 0x7F
        softReset()
        writeReg(TModeReg, 0x80)
        writeReg(TPrescalerReg, 0xA9)
        writeReg(TReloadRegL, 0xE8)
        writeReg(TReloadRegH, 0x03)
        writeReg(TxASKReg, 0x40)
        writeReg(ModeReg, 0x3D)
        antennaOn()
        _initialized = true
    }

        /* NY synlig blokk uten adresse-parameter */
    //% blockId=rfid2_init
    //% block="init RFID2"
    //% weight=101
    export function init(): void {
        initRaw(DEFAULT_ADDR)
    }
    
    //% blockId=rfid2_is_present block="card present?"
    export function isCardPresent(): boolean {
        if (!_initialized) init(I2C_ADDR)
        const req = requestA()
        return req.ok
    }

    //% blockId=rfid2_read_uid block="read card UID (hex)"
    export function readUidHex(): string {
        if (!_initialized) init(I2C_ADDR)
        const req = requestA()
        if (!req.ok) return ""
        const ac1 = anticollSelectCL1()
        if (!ac1.ok) return ""
        // If SAK indicates cascade (bit 2), more levels exist; for simplicity return CL1
        return toHex(ac1.uid)
    }

    //% blockId=rfid2_version block="chip version (raw)"
    export function version(): number {
        if (!_initialized) init(I2C_ADDR)
        return readReg(VersionReg)
    }

    //% blockId=rfid2_set_address block="set I²C address to %addr"
    //% addr.min=0 addr.max=127
    export function setAddress(addr: number) {
        I2C_ADDR = addr & 0x7F
    }
        // --- Hex-nibbles for I²C-adresse (7-bit: 0x08..0x77) ---
    export enum I2CHexHi {
        //% block="0x0"
        H0 = 0,
        //% block="0x1"
        H1 = 1,
        //% block="0x2"
        H2 = 2,
        //% block="0x3"
        H3 = 3,
        //% block="0x4"
        H4 = 4,
        //% block="0x5"
        H5 = 5,
        //% block="0x6"
        H6 = 6,
        //% block="0x7"
        H7 = 7
    }
    
    export enum I2CHexLo {
        //% block="0"
        N0 = 0,
        //% block="1"
        N1 = 1,
        //% block="2"
        N2 = 2,
        //% block="3"
        N3 = 3,
        //% block="4"
        N4 = 4,
        //% block="5"
        N5 = 5,
        //% block="6"
        N6 = 6,
        //% block="7"
        N7 = 7,
        //% block="8"
        N8 = 8,
        //% block="9"
        N9 = 9,
        //% block="A"
        NA = 10,
        //% block="B"
        NB = 11,
        //% block="C"
        NC = 12,
        //% block="D"
        ND = 13,
        //% block="E"
        NE = 14,
        //% block="F"
        NF = 15
    }
    
    /**
     * Bygg en I²C-adresse fra heks nibbles (og valider at den er 0x08..0x77).
     */
    //% blockId=rfid2_hex_addr_builder
    //% block="I²C-hex %hi %lo"
    //% hi.defl=I2CHexHi.H2 lo.defl=I2CHexLo.N8
    //% inlineInputMode=inline
    export function hexAddress(hi: I2CHexHi, lo: I2CHexLo): number {
        const a = ((hi & 0x7) << 4) | (lo & 0xF)
        // Gyldige 7-bit adresser er 0x08..0x77 (0x00..0x07 og 0x78..0x7F er reservert)
        if (a < 0x08 || a > 0x77) return 0x28 // fall back til standarden
        return a
    }
    
    /**
     * Init med heks-nedtrekk (samme som init, men med nibble-valg).
     */
    //% blockId=rfid2_init_hex
    //% block="init RFID2 på I²C-adresse %hi %lo"
    //% hi.defl=I2CHexHi.H2 lo.defl=I2CHexLo.N8
    //% weight=101
    export function initHex(hi: I2CHexHi, lo: I2CHexLo): void {
        const addr = hexAddress(hi, lo)
        init(addr)
    }
    
    /**
     * Endre adresse i etterkant via heks-nedtrekk.
     */
    //% blockId=rfid2_set_addr_hex
    //% block="sett I²C-adresse til %hi %lo"
    //% hi.defl=I2CHexHi.H2 lo.defl=I2CHexLo.N8
    //% weight=60
    export function setAddressHex(hi: I2CHexHi, lo: I2CHexLo): void {
        const addr = hexAddress(hi, lo)
        setAddress(addr)
    }

}
