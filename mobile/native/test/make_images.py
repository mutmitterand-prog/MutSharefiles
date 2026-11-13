#!/usr/bin/env python3
"""Génère des images FAT32, exFAT et NTFS de test (avec MBR/GPT) et la liste attendue (chemin, taille, sha256)."""
import hashlib, os, random, struct, sys, json

random.seed(1234)
def rnd(n): return bytes(random.getrandbits(8) for _ in range(n))
def u16(v): return struct.pack('<H', v)
def u32(v): return struct.pack('<I', v)
def u64(v): return struct.pack('<Q', v)
def pad(b, n): return b + bytes(n - len(b))
def align(n, a): return (n + a - 1) // a * a

EXPECT = {}   # nom d'image -> {chemin: (taille, sha256) | "ERR"}
def record(img, path, data):
    EXPECT.setdefault(img, {})[path] = (len(data), hashlib.sha256(data).hexdigest())

# ------------------------------------------------------------------ FAT32
def fat_checksum(short11):
    s = 0
    for c in short11:
        s = (((s & 1) << 7) + (s >> 1) + c) & 0xFF
    return s

def build_fat32(name):
    BPS, SPC, RES, NF = 512, 1, 32, 2
    TOTAL = 80000
    fatsz = (TOTAL * 4 // BPS) + 8
    data_start = RES + NF * fatsz
    nclusters = TOTAL - data_start
    fat = [0] * (nclusters + 2)
    fat[0] = 0x0FFFFFF8; fat[1] = 0x0FFFFFFF
    clusters = {}
    nxt = [2]
    def alloc(n=1):
        r = list(range(nxt[0], nxt[0] + n)); nxt[0] += n; return r
    def link(cl):
        for a, b in zip(cl, cl[1:]): fat[a] = b
        fat[cl[-1]] = 0x0FFFFFFF
    def write_chain(cl, data):
        link(cl)
        for i, c in enumerate(cl):
            clusters[c] = pad(data[i * BPS:(i + 1) * BPS], BPS)
    used_alias = set()
    def entries(nm, attr, first, size):
        base, dot, ext = nm.rpartition('.') if '.' in nm else (nm, '', '')
        simple = nm.upper() == nm and len(base) <= 8 and len(ext) <= 3 and ' ' not in nm
        if simple:
            short = base.ljust(8)[:8].encode() + ext.ljust(3)[:3].encode(); lfn = False
        else:
            i = 1
            while True:
                a = (''.join(ch if ch.isascii() and ch.isalnum() else '_' for ch in base.upper())[:6] + '~%d' % i).ljust(8)[:8]
                if a not in used_alias: used_alias.add(a); break
                i += 1
            short = a.encode() + ''.join(ch if ch.isascii() else '_' for ch in ext.upper())[:3].ljust(3).encode(); lfn = True
        out = b''
        if lfn:
            chars = list(nm) + ['\0'] if len(nm) % 13 else list(nm)
            while len(chars) % 13: chars.append('\uffff')
            nparts = len(chars) // 13
            ck = fat_checksum(short)
            for seq in range(nparts, 0, -1):
                part = chars[(seq - 1) * 13: seq * 13]
                enc = [c.encode('utf-16-le') for c in part]
                e = bytes([seq | (0x40 if seq == nparts else 0)]) + b''.join(enc[:5]) + b'\x0f\x00' + bytes([ck]) + b''.join(enc[5:11]) + b'\x00\x00' + b''.join(enc[11:13])
                assert len(e) == 32, len(e)
                out += e
        e = short + bytes([attr, 0]) + b'\x00' * 7
        e = short + bytes([attr, 0, 0]) + u16(0) + u16(0) + u16(0) + u16(first >> 16) + u16(0) + u16(0) + u16(first & 0xFFFF) + u32(size)
        assert len(e) == 32
        return out + e
    def make_dir(items, parent_cluster):
        raw = b''
        for nm, attr, first, size in items: raw += entries(nm, attr, first, size)
        return raw
    def add_file(data):
        if not data: return 0
        n = (len(data) + BPS - 1) // BPS
        cl = alloc(n); write_chain(cl, data); return cl[0]
    # fichiers
    paths = {}
    hello = b'Bonjour FAT32\n'
    big1 = rnd(20000); big2 = rnd(20000)
    # fragmentation : clusters alternés entre deux fichiers
    n1 = (len(big1) + BPS - 1) // BPS
    inter = alloc(n1 * 2)
    cl1 = inter[0::2]; cl2 = inter[1::2]
    write_chain(cl1, big1); write_chain(cl2, big2)
    inner = rnd(100000); deep = b'dans le sous-sous-dossier'
    sub2_cl = alloc(1)[0]
    deep_first = add_file(deep)
    write_chain([sub2_cl], make_dir([('.', 0x10, sub2_cl, 0), ('..', 0x10, 0, 0), ('deep.txt', 0x20, deep_first, len(deep))], 0))
    docs_cl = alloc(1)[0]
    inner_first = add_file(inner)
    write_chain([docs_cl], make_dir([('.', 0x10, docs_cl, 0), ('..', 0x10, 0, 0), ('inner.bin', 0x20, inner_first, len(inner)), ('Sous Dossier', 0x10, sub2_cl, 0)], 0))
    hello_first = add_file(hello)
    root = [('HELLO.TXT', 0x20, hello_first, len(hello)),
            ('Long File Name with spaces.txt', 0x20, cl1[0], len(big1)),
            ('été.dat', 0x20, cl2[0], len(big2)),
            ('Docs', 0x10, docs_cl, 0),
            ('empty.txt', 0x20, 0, 0)]
    root_raw = make_dir(root, 2)
    # racine en cluster 2 : réserver avant les autres ! -> on recopie : cluster 2 doit être la racine
    return finalize_fat32(name, BPS, SPC, RES, NF, TOTAL, fatsz, fat, clusters, root_raw, hello, big1, big2, inner, deep)

def finalize_fat32(name, BPS, SPC, RES, NF, TOTAL, fatsz, fat, clusters, root_raw, hello, big1, big2, inner, deep):
    # Le cluster 2 a été utilisé par les données ; on déplace la racine dans un nouveau cluster libre et on la déclare.
    free = max(clusters) + 1
    rcl = []
    n = (len(root_raw) + BPS - 1) // BPS
    rcl = list(range(free, free + n))
    for a, b in zip(rcl, rcl[1:]): fat[a] = b
    fat[rcl[-1]] = 0x0FFFFFFF
    for i, c in enumerate(rcl): clusters[c] = pad(root_raw[i * BPS:(i + 1) * BPS], BPS)
    img = bytearray(TOTAL * BPS)
    boot = bytearray(512)
    boot[0:3] = b'\xEB\x58\x90'; boot[3:11] = b'MSDOS5.0'
    struct.pack_into('<HBHBHHBHHHII', boot, 11, BPS, SPC, RES, NF, 0, 0, 0xF8, 0, 63, 255, 0, TOTAL)
    struct.pack_into('<I', boot, 36, fatsz)
    struct.pack_into('<HHI', boot, 40, 0, 0, rcl[0])
    struct.pack_into('<HH', boot, 48, 1, 6)
    boot[64] = 0x80; boot[66] = 0x29; struct.pack_into('<I', boot, 67, 0xCAFEBABE)
    boot[71:82] = b'TESTFAT32  '; boot[82:90] = b'FAT32   '; boot[510:512] = b'\x55\xAA'
    img[0:512] = boot; img[6 * 512:7 * 512] = boot
    fat_bytes = b''.join(u32(v) for v in fat)
    for k in range(NF):
        o = (RES + k * fatsz) * BPS
        img[o:o + len(fat_bytes)] = fat_bytes
    ds = (RES + NF * fatsz) * BPS
    for c, d in clusters.items():
        o = ds + (c - 2) * BPS; img[o:o + BPS] = d
    exp = {'HELLO.TXT': hello, 'Long File Name with spaces.txt': big1, 'été.dat': big2, 'empty.txt': b'',
           'Docs/inner.bin': inner, 'Docs/Sous Dossier/deep.txt': deep}
    for p, d in exp.items(): record(name, p, d)
    return bytes(img)

# ------------------------------------------------------------------ exFAT
def build_exfat(name):
    BPS_SHIFT, SPC_SHIFT = 9, 3
    BPS = 512; CB = BPS << SPC_SHIFT
    FAT_OFF = 24; CLUSTERS = 10000
    FAT_LEN = align((CLUSTERS + 2) * 4, BPS) // BPS
    HEAP_OFF = align(FAT_OFF + FAT_LEN, 8)
    total_sectors = HEAP_OFF + CLUSTERS * (CB // BPS)
    img = bytearray(total_sectors * BPS)
    fat = [0] * (CLUSTERS + 2); fat[0] = 0xFFFFFFF8; fat[1] = 0xFFFFFFFF
    nxt = [2]
    def alloc(n):
        r = list(range(nxt[0], nxt[0] + n)); nxt[0] += n; return r
    def put(c, data):
        o = (HEAP_OFF * BPS) + (c - 2) * CB; img[o:o + len(data)] = data
    bitmap_cl = alloc(1)[0]; upcase_cl = alloc(1)[0]; root_cl = alloc(1)[0]
    def hashname(nm):
        h = 0
        for ch in nm.encode('utf-16-le'):
            h = (((h << 15) | (h >> 1)) + ch) & 0xFFFF
        return h
    def fileset(nm, attr, first, length, nofat, valid=None):
        valid = length if valid is None else valid
        nb = nm.encode('utf-16-le'); ncount = len(nm)
        nameents = []
        for i in range(0, ncount, 15):
            part = nm[i:i + 15]
            nameents.append(b'\xC1\x00' + pad(part.encode('utf-16-le'), 30))
        sec = 1 + len(nameents)
        e0 = bytearray(32); e0[0] = 0x85; e0[1] = sec; struct.pack_into('<H', e0, 4, attr)
        e1 = bytearray(32); e1[0] = 0xC0; e1[1] = 0x01 | (0x02 if nofat else 0); e1[3] = ncount
        struct.pack_into('<H', e1, 4, hashname(nm.upper())); struct.pack_into('<Q', e1, 8, valid); struct.pack_into('<I', e1, 20, first); struct.pack_into('<Q', e1, 24, length)
        allb = bytes(e0) + bytes(e1) + b''.join(nameents)
        ck = 0
        for i, b in enumerate(allb):
            if i in (2, 3): continue
            ck = (((ck << 15) | (ck >> 1)) + b) & 0xFFFF
        e0[2:4] = u16(ck)
        return bytes(e0) + bytes(e1) + b''.join(nameents)
    def store_contig(data):
        if not data: return 0, True
        n = (len(data) + CB - 1) // CB; cl = alloc(n)
        for i, c in enumerate(cl): fat[c] = cl[i + 1] if i + 1 < n else 0xFFFFFFFF
        put(cl[0], data); return cl[0], True
    def store_chain(data):
        n = (len(data) + CB - 1) // CB; inter = alloc(n * 2); mine = inter[0::2]
        for i, c in enumerate(mine): fat[c] = mine[i + 1] if i + 1 < n else 0xFFFFFFFF
        for i, c in enumerate(mine): put(c, data[i * CB:(i + 1) * CB])
        return mine[0]
    def store_dir(raw):
        cl, _ = store_contig(raw + b'\x00' * 32); return cl, len(raw) + 32
    hello = b'Bonjour exFAT\n'; frag = rnd(50000); big = rnd(30000); unic = rnd(777)
    inner = b'fichier dans un sous-dossier'
    f_hello, _ = store_contig(hello)
    f_frag = store_chain(frag)
    f_big, _ = store_contig(big)
    f_unic, _ = store_contig(unic)
    f_inner, _ = store_contig(inner)
    sub_raw = fileset('inner.txt', 0x20, f_inner, len(inner), True)
    sub_cl, sub_len = store_dir(sub_raw)
    many = {}
    many_raw = b''
    for i in range(200):
        d = ('contenu %d' % i).encode(); c, _ = store_contig(d); nm = 'fichier_numero_%03d_avec_un_nom_assez_long.txt' % i
        many_raw += fileset(nm, 0x20, c, len(d), True); many['Many/' + nm] = d
    many_cl, many_len = store_dir(many_raw)
    nm_hidden = fileset('System Volume Information', 0x16, 0, 0, True)
    root_raw = bytearray()
    lab = bytearray(32); lab[0] = 0x83; lab[1] = 7; lab[2:16] = 'TESTEXF'.encode('utf-16-le'); root_raw += lab
    bm = bytearray(32); bm[0] = 0x81; struct.pack_into('<I', bm, 20, bitmap_cl); struct.pack_into('<Q', bm, 24, CLUSTERS // 8); root_raw += bm
    up = bytearray(32); up[0] = 0x82; struct.pack_into('<I', up, 20, upcase_cl); struct.pack_into('<Q', up, 24, 128); root_raw += up
    root_raw += fileset('hello.txt', 0x20, f_hello, len(hello), True)
    root_raw += fileset('fragmenté.bin', 0x20, f_frag, len(frag), False)
    root_raw += fileset('gros fichier.dat', 0x20, f_big, len(big), True)
    root_raw += fileset('日本語ファイル.txt', 0x20, f_unic, len(unic), True)
    root_raw += fileset('Dossier', 0x10, sub_cl, sub_len, True)
    root_raw += fileset('Many', 0x10, many_cl, many_len, True)
    root_raw += nm_hidden
    put(root_cl, bytes(root_raw))
    fat[bitmap_cl] = fat[upcase_cl] = fat[root_cl] = 0xFFFFFFFF
    put(bitmap_cl, b'\xff' * (CLUSTERS // 8))
    vbr = bytearray(512)
    vbr[0:3] = b'\xEB\x76\x90'; vbr[3:11] = b'EXFAT   '
    struct.pack_into('<Q', vbr, 64, 0); struct.pack_into('<Q', vbr, 72, total_sectors)
    struct.pack_into('<I', vbr, 80, FAT_OFF); struct.pack_into('<I', vbr, 84, FAT_LEN)
    struct.pack_into('<I', vbr, 88, HEAP_OFF); struct.pack_into('<I', vbr, 92, CLUSTERS); struct.pack_into('<I', vbr, 96, root_cl)
    struct.pack_into('<I', vbr, 100, 0x12345678); struct.pack_into('<H', vbr, 104, 0x0100)
    vbr[108] = BPS_SHIFT; vbr[109] = SPC_SHIFT; vbr[110] = 1; vbr[510:512] = b'\x55\xAA'
    img[0:512] = vbr
    fb = b''.join(u32(v) for v in fat); img[FAT_OFF * BPS:FAT_OFF * BPS + len(fb)] = fb
    exp = {'hello.txt': hello, 'fragmenté.bin': frag, 'gros fichier.dat': big, '日本語ファイル.txt': unic, 'Dossier/inner.txt': inner}
    exp.update(many)
    for p, d in exp.items(): record(name, p, d)
    return bytes(img)

# ------------------------------------------------------------------ NTFS
CLUSTER = 4096; RECSZ = 1024; IDXSZ = 4096
def runlist(runs):
    out = b''; prev = 0
    for length, lcn in runs:
        lb = max(1, (length.bit_length() + 7) // 8)
        if lcn is None:
            out += bytes([lb]) + length.to_bytes(lb, 'little'); continue
        d = lcn - prev; prev = lcn
        ob = 1
        while not (-(1 << (8 * ob - 1)) <= d < (1 << (8 * ob - 1))): ob += 1
        out += bytes([lb | (ob << 4)]) + length.to_bytes(lb, 'little') + d.to_bytes(ob, 'little', signed=True)
    return out + b'\x00'

def attr_res(atype, content, name='', aid=0, flags=0):
    nb = name.encode('utf-16-le'); coff = align(24 + len(nb), 8); total = align(coff + len(content), 8)
    h = struct.pack('<IIBBHHH', atype, total, 0, len(name), 24 if name else 0, flags, aid) + struct.pack('<IHBB', len(content), coff, 0, 0)
    return pad(h + nb, coff) + pad(content, total - coff)

def attr_nonres(atype, runs_bytes, start_vcn, end_vcn, alloc, real, init, name='', aid=0, flags=0):
    nb = name.encode('utf-16-le'); roff = align(64 + len(nb), 8); total = align(roff + len(runs_bytes), 8)
    h = struct.pack('<IIBBHHH', atype, total, 1, len(name), 64 if name else 0, flags, aid)
    h += u64(start_vcn) + u64(end_vcn) + struct.pack('<HH', roff, 0) + b'\0\0\0\0' + u64(alloc) + u64(real) + u64(init)
    return pad(h + nb, roff) + pad(runs_bytes, total - roff)

def make_record(attrs, flags, recno, base=0, seq=1):
    rec = bytearray(RECSZ)
    rec[0:4] = b'FILE'; usa_cnt = 1 + RECSZ // 512
    struct.pack_into('<HH', rec, 4, 0x30, usa_cnt); struct.pack_into('<HH', rec, 16, seq, 1)
    first = align(0x30 + 2 * usa_cnt, 8); struct.pack_into('<HH', rec, 20, first, flags)
    o = first
    for a in attrs: rec[o:o + len(a)] = a; o += len(a)
    rec[o:o + 4] = b'\xff\xff\xff\xff'; o += 8
    struct.pack_into('<II', rec, 24, o, RECSZ); struct.pack_into('<Q', rec, 32, base); struct.pack_into('<I', rec, 44, recno)
    assert len(rec) == RECSZ, ('enregistrement trop grand', recno, len(rec))
    return fix(rec, 0xABCD)

def fix(buf, usn):
    usa = struct.unpack_from('<H', buf, 4)[0]; cnt = struct.unpack_from('<H', buf, 6)[0]
    struct.pack_into('<H', buf, usa, usn)
    for i in range(1, cnt):
        p = i * 512 - 2
        buf[usa + 2 * i:usa + 2 * i + 2] = buf[p:p + 2]
        struct.pack_into('<H', buf, p, usn)
    return bytes(buf)

def filename_key(parent, name, flags, real, ntype=1):
    nb = name.encode('utf-16-le')
    return u64(parent | (1 << 48)) + bytes(32) + u64(real) + u64(real) + u32(flags) + u32(0) + bytes([len(name), ntype]) + nb

def index_entry(recno, key, subvcn=None):
    kl = len(key); el = align(16 + kl, 8) + (8 if subvcn is not None else 0)
    e = u64(recno | (1 << 48)) + struct.pack('<HHHH', el, kl, 1 if subvcn is not None else 0, 0) + key
    e = pad(e, el - (8 if subvcn is not None else 0))
    if subvcn is not None: e += u64(subvcn)
    return e

def last_entry(subvcn=None):
    el = 24 if subvcn is not None else 16
    return u64(0) + struct.pack('<HHHH', el, 0, 2 | (1 if subvcn is not None else 0), 0) + (u64(subvcn) if subvcn is not None else b'')

def index_root(entries_bytes, large):
    nh = struct.pack('<IIIBxxx', 16, 16 + len(entries_bytes), 16 + len(entries_bytes), 1 if large else 0)
    return struct.pack('<IIIBxxx', 0x30, 1, IDXSZ, 1) + nh + entries_bytes

def build_ntfs(name, compressed_test=True):
    NCL = 2048
    img = bytearray(NCL * CLUSTER)
    mft_lcn = 4; mft_clusters = 40; nrec = mft_clusters * CLUSTER // RECSZ
    records = {}
    nxt = [60]
    def alloc(n): r = nxt[0]; nxt[0] += n; return r
    def put_clusters(lcn, data): img[lcn * CLUSTER:lcn * CLUSTER + len(data)] = data
    exp = {}
    def std_info(): return attr_res(0x10, bytes(48))
    def fn_attr(parent, nm, flags, real): return attr_res(0x30, filename_key(parent, nm, flags, real), aid=1)
    next_rec = [24]
    def new_rec(): r = next_rec[0]; next_rec[0] += 1; return r
    sub_dir = new_rec()
    dir_entries = {5: [], sub_dir: []}
    def add_to_dir(dirrec, nm, rec, flags, real):
        dir_entries.setdefault(dirrec, []).append((nm, rec, flags, real))
    # fichiers
    r = new_rec(); small = 'Bonjour NTFS, fichier résident\n'.encode()
    records[r] = make_record([std_info(), fn_attr(5, 'small.txt', 0x20, len(small)), attr_res(0x80, small, aid=2)], 1, r)
    add_to_dir(5, 'small.txt', r, 0x20, len(small)); exp['small.txt'] = small
    # grand fichier : 3 extents + 1 trou, ordre LCN non croissant pour tester les deltas négatifs
    r = new_rec(); big = rnd(4096 * 9 + 1000)
    c1 = alloc(3); c2 = alloc(2); c0 = alloc(3)   # 3 + 2 (puis trou 1) + 3  -> 8 clusters + trou 1 = 9 clusters + reste
    # contenu logique : 3 clusters (c1), 2 clusters (c2), 1 cluster creux, 3 clusters (c0), partiel
    logical = bytearray(big[:3 * CLUSTER + 2 * CLUSTER]) + bytearray(CLUSTER) + bytearray(big[5 * CLUSTER + CLUSTER: 5 * CLUSTER + CLUSTER + 2 * CLUSTER + 1000])
    # on reconstruit "big" exact
    big = bytes(logical)
    put_clusters(c1, big[0:3 * CLUSTER]); put_clusters(c2, big[3 * CLUSTER:5 * CLUSTER]); put_clusters(c0 - 0, big[6 * CLUSTER:])
    rl = runlist([(3, c1), (2, c2), (1, None), (3, c0)])
    records[r] = make_record([std_info(), fn_attr(5, 'large.bin', 0x20, len(big)),
        attr_nonres(0x80, rl, 0, 8, 9 * CLUSTER, len(big), len(big), aid=2)], 1, r)
    add_to_dir(5, 'large.bin', r, 0x20, len(big)); exp['large.bin'] = big
    # fichier fragmenté avec liste d'attributs et enregistrement d'extension
    r = new_rec(); ext = new_rec(); frag = rnd(CLUSTER * 6 - 123)
    f1 = alloc(2); f2 = alloc(4)
    put_clusters(f1, frag[:2 * CLUSTER]); put_clusters(f2, frag[2 * CLUSTER:])
    rl1 = runlist([(2, f1)]); rl2 = runlist([(4, f2)])
    def al_entry(atype, startvcn, ref, aid):
        return pad(struct.pack('<IHBBQQH', atype, 32, 0, 26, startvcn, ref | (1 << 48), aid), 32)
    alist = al_entry(0x10, 0, r, 0) + al_entry(0x30, 0, r, 1) + al_entry(0x80, 0, r, 2) + al_entry(0x80, 2, ext, 3)
    records[r] = make_record([std_info(), attr_res(0x20, alist, aid=4), fn_attr(5, 'fragmente.bin', 0x20, len(frag)),
        attr_nonres(0x80, rl1, 0, 1, 2 * CLUSTER, len(frag), len(frag), aid=2)], 1, r)
    records[ext] = make_record([attr_nonres(0x80, rl2, 2, 5, 4 * CLUSTER, 0, 0, aid=3)], 1, ext, base=r)
    add_to_dir(5, 'fragmenté.bin', r, 0x20, len(frag)); exp['fragmenté.bin'] = frag
    # nom unicode + fichier vide
    r = new_rec(); records[r] = make_record([std_info(), fn_attr(5, 'vide.txt', 0x20, 0)], 1, r); add_to_dir(sub_dir, 'vide.txt', r, 0x20, 0); exp['Docs/vide.txt'] = b''
    # compressé
    if compressed_test:
        r = new_rec(); cc = alloc(1)
        records[r] = make_record([std_info(), fn_attr(5, 'compresse.bin', 0x20, 5000),
            attr_nonres(0x80, runlist([(1, cc)]), 0, 0, CLUSTER, 5000, 5000, aid=2, flags=0x0001)], 1, r)
        add_to_dir(sub_dir, 'compresse.bin', r, 0x20, 5000); exp['Docs/compresse.bin'] = 'ERR'
    # fichier caché système (ne doit pas apparaître)
    r = new_rec(); records[r] = make_record([std_info(), fn_attr(5, 'pagefile.sys', 0x26, 10), attr_res(0x80, b'x' * 10, aid=2)], 1, r)
    add_to_dir(sub_dir, 'pagefile.sys', r, 0x26, 10)
    # nom DOS dupliqué (ne doit pas apparaître deux fois)
    # dossier avec INDEX_ALLOCATION
    big_dir = new_rec()
    many = []
    for i in range(60):
        rr = new_rec(); d = ('contenu NTFS %d' % i).encode(); nm = 'fichier_%03d_avec_un_nom_long.txt' % i
        records[rr] = make_record([std_info(), fn_attr(big_dir, nm, 0x20, len(d)), attr_res(0x80, d, aid=2)], 1, rr)
        many.append((nm, rr, 0x20, len(d))); exp['Big/' + nm] = d
    def make_indx(vcn, items):
        blk = bytearray(IDXSZ); blk[0:4] = b'INDX'; usa_cnt = 1 + IDXSZ // 512
        struct.pack_into('<HH', blk, 4, 0x28, usa_cnt); struct.pack_into('<Q', blk, 16, vcn)
        ents = b''.join(index_entry(rr, filename_key(big_dir, nm, fl, real), None) for nm, rr, fl, real in items) + last_entry()
        eo = align(0x28 + 2 * usa_cnt, 8)
        assert eo + len(ents) <= IDXSZ, 'bloc INDX trop plein'
        struct.pack_into('<IIIB', blk, 24, eo - 24, eo - 24 + len(ents), IDXSZ - 24, 0)
        blk[eo:eo + len(ents)] = ents
        return fix(blk, 0x1357)
    sepA, sepB = many[0], many[1]
    rest = many[2:]
    chunks = [rest[0:20], rest[20:40], rest[40:]]
    idx_lcn = alloc(3)
    for i, ch in enumerate(chunks): put_clusters(idx_lcn + i, make_indx(i, ch))
    root_ents = (index_entry(sepA[1], filename_key(big_dir, sepA[0], sepA[2], sepA[3]), subvcn=1)
                 + index_entry(sepB[1], filename_key(big_dir, sepB[0], sepB[2], sepB[3]), subvcn=2) + last_entry(subvcn=0))
    records[big_dir] = make_record([std_info(), fn_attr(5, 'Big', 0x10000000, 0),
        attr_res(0x90, index_root(root_ents, True), name='$I30', aid=3),
        attr_nonres(0xA0, runlist([(3, idx_lcn)]), 0, 2, 3 * CLUSTER, 3 * CLUSTER, 3 * CLUSTER, name='$I30', aid=4)], 3, big_dir)
    add_to_dir(5, 'Big', big_dir, 0x10000000, 0)
    # sous-dossier simple
    ri = new_rec(); inner = 'dans le dossier Docs'.encode()
    records[ri] = make_record([std_info(), fn_attr(sub_dir, 'inner.txt', 0x20, len(inner)), attr_res(0x80, inner, aid=2)], 1, ri)
    records[sub_dir] = make_record([std_info(), fn_attr(5, 'Docs', 0x10000000, 0),
        attr_res(0x90, index_root(b''.join(index_entry(rr, filename_key(sub_dir, nm, fl, real)) for nm, rr, fl, real in dir_entries[sub_dir]) + index_entry(ri, filename_key(sub_dir, 'inner.txt', 0x20, len(inner))) + last_entry(), False), name='$I30', aid=3)], 3, sub_dir)
    add_to_dir(5, 'Docs', sub_dir, 0x10000000, 0); exp['Docs/inner.txt'] = inner
    # racine
    ents = b'' + index_entry(5, filename_key(5, '.', 0x10000000, 0), None)
    for nm, rr, fl, real in dir_entries[5]:
        ents += index_entry(rr, filename_key(5, nm, fl, real))
    ents += last_entry()
    records[5] = make_record([std_info(), fn_attr(5, '.', 0x10000000, 0), attr_res(0x90, index_root(ents, False), name='$I30', aid=3)], 3, 5)
    # $Volume
    records[3] = make_record([std_info(), attr_res(0x60, 'TESTNTFS'.encode('utf-16-le'), aid=2)], 1, 3)
    # $MFT
    mft_rl = runlist([(mft_clusters, mft_lcn)])
    records[0] = make_record([std_info(), fn_attr(5, '$MFT', 0x6, mft_clusters * CLUSTER),
        attr_nonres(0x80, mft_rl, 0, mft_clusters - 1, mft_clusters * CLUSTER, mft_clusters * CLUSTER, mft_clusters * CLUSTER, aid=2)], 1, 0)
    assert max(records) < nrec
    for n, rec in records.items():
        o = mft_lcn * CLUSTER + n * RECSZ; img[o:o + RECSZ] = rec
    boot = bytearray(512)
    boot[0:3] = b'\xEB\x52\x90'; boot[3:11] = b'NTFS    '
    struct.pack_into('<HB', boot, 11, 512, CLUSTER // 512); struct.pack_into('<BHH', boot, 21, 0xF8, 0, 0)
    struct.pack_into('<Q', boot, 40, NCL * CLUSTER // 512 - 1); struct.pack_into('<Q', boot, 48, mft_lcn); struct.pack_into('<Q', boot, 56, 8)
    boot[64] = 0xF6; boot[68] = 1; struct.pack_into('<Q', boot, 72, 0x1122334455667788); boot[510:512] = b'\x55\xAA'
    img[0:512] = boot
    assert len(img) == NCL * CLUSTER, len(img)
    for p, d in exp.items(): record(name, p, d) if d != 'ERR' else EXPECT.setdefault(name, {}).__setitem__(p, 'ERR')
    return bytes(img)

# ------------------------------------------------------------------ enveloppes de partition
def wrap_mbr(part, ptype, bs=512):
    start = 2048 * 512 // bs
    img = bytearray(start * bs + len(part) + 4096)
    mbr = bytearray(512)
    mbr[446:462] = bytes([0x80, 0, 0, 0, ptype, 0, 0, 0]) + u32(start) + u32(len(part) // bs)
    mbr[510:512] = b'\x55\xAA'; img[0:512] = mbr; img[start * bs:start * bs + len(part)] = part
    return bytes(img)

def wrap_gpt(part, bs=512):
    import zlib
    start = 2048 * 512 // bs
    nsec = len(part) // bs + start + 4096 // bs + 40
    img = bytearray(nsec * bs)
    prot = bytearray(512); prot[446:462] = bytes([0, 0, 2, 0, 0xEE, 0xFF, 0xFF, 0xFF]) + u32(1) + u32(0xFFFFFFFF); prot[510:512] = b'\x55\xAA'; img[0:512] = prot
    ent = bytearray(128); ent[0:16] = bytes.fromhex('a2a0d0ebe5b9334487c068b6b72699c7'); ent[16:32] = bytes(range(1, 17))
    struct.pack_into('<QQ', ent, 32, start, start + len(part) // bs - 1); ent[56:56 + 28] = 'Données'.encode('utf-16-le').ljust(28, b'\0')
    table = bytes(ent) + bytes(128 * 127)
    hdr = bytearray(92); hdr[0:8] = b'EFI PART'; struct.pack_into('<IIIIQQQQ', hdr, 8, 0x10000, 92, 0, 0, 1, nsec - 1, 34, nsec - 34)
    hdr[56:72] = bytes(16); struct.pack_into('<QIII', hdr, 72, 2, 128, 128, zlib.crc32(table))
    struct.pack_into('<I', hdr, 16, zlib.crc32(bytes(hdr)))
    img[bs:bs + 92] = hdr; img[2 * bs:2 * bs + len(table)] = table; img[start * bs:start * bs + len(part)] = part
    return bytes(img)

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    fat = build_fat32('fat32'); ex = build_exfat('exfat'); nt = build_ntfs('ntfs')
    def save(n, data, expname):
        open(os.path.join(out, n + '.img'), 'wb').write(data)
        EXPECT[n] = EXPECT[expname]
    save('fat32_raw', fat, 'fat32'); save('fat32_mbr', wrap_mbr(fat, 0x0C), 'fat32')
    save('exfat_raw', ex, 'exfat'); save('exfat_mbr', wrap_mbr(ex, 0x07), 'exfat'); save('exfat_gpt', wrap_gpt(ex), 'exfat')
    save('ntfs_raw', nt, 'ntfs'); save('ntfs_mbr', wrap_mbr(nt, 0x07), 'ntfs'); save('ntfs_gpt', wrap_gpt(nt), 'ntfs')
    save('ntfs_gpt_4k', wrap_gpt(nt, 4096), 'ntfs'); save('ntfs_mbr_4k', wrap_mbr(nt, 0x07, 4096), 'ntfs')
    json.dump({k: v for k, v in EXPECT.items()}, open(os.path.join(out, 'expected.json'), 'w'), ensure_ascii=False, indent=1)
    print('images:', sorted(f for f in os.listdir(out) if f.endswith('.img')))
