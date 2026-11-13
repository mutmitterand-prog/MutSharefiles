package com.transfert.app.usbfs;

import java.io.IOException;

public interface FsFile {
    long size();
    /** Lit jusqu'à len octets à partir de pos ; retourne -1 si pos est à la fin du fichier. */
    int read(long pos, byte[] dst, int off, int len) throws IOException;
}
