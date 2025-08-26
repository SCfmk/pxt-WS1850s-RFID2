input.onButtonPressed(Button.A, function () {
    basic.showIcon(IconNames.SmallSquare)
    if (rfid2.isCardPresent()) {
        const uid = rfid2.readUidHex()
        if (uid.length > 0) {
            basic.showString(uid)
        } else {
            basic.showString("No UID")
        }
    } else {
        basic.showString("No card")
    }
    basic.clearScreen()
})

basic.pause(100)
rfid2.init()
basic.showString("RFID2")
