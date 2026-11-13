package com.transfert.app.usbfs;

import java.io.IOException;

/** Périphérique de stockage en blocs (disque ou clé USB), en lecture seule. */
public interface BlockDevice {
    int blockSize();
    long blockCount();
    void readBlocks(long lba, int count, byte[] dst, int off) throws IOException;
}
