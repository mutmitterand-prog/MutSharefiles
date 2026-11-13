package com.transfert.app.usbfs;

import java.io.IOException;
import java.util.List;

/** Lecture seule d'un système de fichiers (FAT16/FAT32, exFAT, NTFS). */
public interface FileSystemReader {
    String type();
    String label();
    FsEntry root();
    List<FsEntry> list(FsEntry dir) throws IOException;
    FsFile open(FsEntry file) throws IOException;
}
