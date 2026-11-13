#!/usr/bin/env python3
"""Génère les images, exécute SelfTest (accès direct et via SCSI/Bulk-Only émulé) et compare à la liste attendue."""
import json, os, subprocess, sys, tempfile
here = os.path.dirname(os.path.abspath(__file__))
work = tempfile.mkdtemp(prefix='usbfs-')
subprocess.check_call([sys.executable, os.path.join(here, 'make_images.py'), work], stdout=subprocess.DEVNULL)
cls = os.path.join(work, 'classes'); os.makedirs(cls)
srcs = [os.path.join(here, '..', 'usbfs', f) for f in os.listdir(os.path.join(here, '..', 'usbfs')) if f.endswith('.java')] + [os.path.join(here, 'SelfTest.java')]
subprocess.check_call(['java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-nowarn', '-d', cls] + srcs)
expected = json.load(open(os.path.join(work, 'expected.json')))
failures = 0
for name, exp in sorted(expected.items()):
    if not os.path.exists(os.path.join(work, name + '.img')): continue
    bs = 4096 if name.endswith('_4k') else 512
    for mode in ('direct', 'scsi'):
        res = subprocess.run(['java', '-cp', cls, 'SelfTest', os.path.join(work, name + '.img'), str(bs), mode], capture_output=True, text=True)
        if res.returncode != 0:
            print('ECHEC', name, mode, res.stderr[-600:]); failures += 1; continue
        got = {}; vols = 0
        for line in res.stdout.splitlines():
            if line.startswith('#volumes'): vols = int(line.split('\t')[1])
            elif line.startswith('#'): pass
            elif line.startswith('!!'): print('  ', line); failures += 1
            else:
                p, size, h = line.split('\t'); got[p] = 'ERR' if size == 'ERR' else (int(size), h)
        want = {k: ('ERR' if v == 'ERR' else tuple(v)) for k, v in exp.items()}
        missing = set(want) - set(got); extra = set(got) - set(want)
        bad = [k for k in want if k in got and got[k] != want[k]]
        ok = vols == 1 and not missing and not extra and not bad
        print(('OK    ' if ok else 'ECHEC ') + name.ljust(16) + mode.ljust(7) + '%d fichiers' % len(got))
        if not ok:
            failures += 1
            print('   volumes:', vols, 'manquants:', sorted(missing)[:5], 'en trop:', sorted(extra)[:5], 'différents:', bad[:5])
            print('   ', res.stdout[:500])
sys.exit(1 if failures else 0)
