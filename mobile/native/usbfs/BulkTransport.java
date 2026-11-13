package com.transfert.app.usbfs;

/** Transferts USB bulk. Implémenté sur Android par UsbDeviceConnection (voir UsbDirectPlugin). */
public interface BulkTransport {
    int bulkOut(byte[] buf, int off, int len, int timeoutMs);
    int bulkIn(byte[] buf, int off, int len, int timeoutMs);
    void clearHalt(boolean in);
    boolean resetRecovery();
    int maxPacket(boolean in);
}
