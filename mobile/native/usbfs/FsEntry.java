package com.transfert.app.usbfs;

/** Fichier ou dossier d'un volume. Les champs id/aux/flags sont propres à chaque système de fichiers. */
public final class FsEntry {
    public final String name;
    public final boolean directory;
    public final long size;
    public final long id;
    public final long aux;
    public final int flags;

    public FsEntry(String name, boolean directory, long size, long id, long aux, int flags) {
        this.name = name;
        this.directory = directory;
        this.size = size;
        this.id = id;
        this.aux = aux;
        this.flags = flags;
    }
}
