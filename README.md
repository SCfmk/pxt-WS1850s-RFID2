# pxt-WS1850s-RFID2
Library to use M5 Stack RFID 2 in Makecode

# WS1850S RFID2 for micro:bit (MakeCode)

Driver for **M5Stack RFID 2 Unit (WS1850S)** over I²C. Provides blocks for initializing the reader, checking for a card, and reading the card UID (hex).

- Default I²C address: **0x28**.
- Supported tags: ISO/IEC 14443 Type A (MIFARE / NTAG) UID read.
- Micro:bit I²C pins: **SCL=P19**, **SDA=P20**.

## Blocks
- **init(address)**: Initialize reader (turns on RF field).
- **card present?**: Fast check using REQA.
- **read card UID (hex)**: Returns UID (first cascade level) as lowercase hex, or empty string if none.
- **chip version (raw)**: Returns `VersionReg` value (useful for debugging).

## Wiring
Use an adapter to bring the Grove HY2.0-4P of RFID2 to micro:bit I²C (3V, GND, SDA=P20, SCL=P19). Ensure pull-ups are present (most M5 Units already include them).

## Notes
This is a minimal ISO14443A implementation focused on UID reading. Multi-cascade UIDs (7/10 bytes) currently return the first cascade level only. Authentication and data read/write are not implemented (could be added later).

The library has been built with ChatGPT 5
