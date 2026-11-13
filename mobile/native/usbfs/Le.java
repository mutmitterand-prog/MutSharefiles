package com.transfert.app.usbfs;

/** Lecture d'entiers little-endian dans un tampon. */
final class Le {
    private Le() {}
    static int u8(byte[] b, int o) { return b[o] & 0xff; }
    static int u16(byte[] b, int o) { return (b[o] & 0xff) | ((b[o + 1] & 0xff) << 8); }
    static long u32(byte[] b, int o) {
        return (b[o] & 0xffL) | ((b[o + 1] & 0xffL) << 8) | ((b[o + 2] & 0xffL) << 16) | ((b[o + 3] & 0xffL) << 24);
    }
    static long u64(byte[] b, int o) { return u32(b, o) | (u32(b, o + 4) << 32); }
    static long be32(byte[] b, int o) {
        return ((b[o] & 0xffL) << 24) | ((b[o + 1] & 0xffL) << 16) | ((b[o + 2] & 0xffL) << 8) | (b[o + 3] & 0xffL);
    }
    static long be64(byte[] b, int o) { return (be32(b, o) << 32) | be32(b, o + 4); }
}
