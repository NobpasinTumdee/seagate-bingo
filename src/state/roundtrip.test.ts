// "Another machine" tests: generate on machine A -> export -> wipe everything -> import on machine B.
// Each machine has its own localStorage, IndexedDB, module state and its own copy of /assets.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardSize, GameConfig, SymbolItem, SymbolMode } from '../core/types';
import { bootMachine, bytes, type Assets } from '../test/machine';

const SEAGATE = ['exos', 'ironwolf', 'barracuda', 'firecuda', 'skyhawk', 'nytro'];
const assetsA: Assets = {
  '/assets/brand/event-logo.svg': bytes('<svg>real event logo on machine A</svg>'),
  ...Object.fromEntries(SEAGATE.map((id) => [`/assets/symbols/seagate/${id}.png`, bytes(`${id} logo A`)])),
};
// machine B: placeholder logo, only two product logos copied, and one of them is a different file
const assetsB: Assets = {
  '/assets/brand/event-logo.svg': bytes('<svg>placeholder</svg>'),
  '/assets/symbols/seagate/exos.png': bytes('exos logo B (different file!)'),
  '/assets/symbols/seagate/nytro.png': bytes('nytro logo A'),
};

type Mods = {
  store: typeof import('./gameStore');
  cardSet: typeof import('./cardSet');
  backup: typeof import('./backupFile');
  images: typeof import('./images');
  frozen: typeof import('../core/frozen');
  cards: typeof import('../core/cards');
};
async function mods(): Promise<Mods> {
  return {
    store: await import('./gameStore'),
    cardSet: await import('./cardSet'),
    backup: await import('./backupFile'),
    images: await import('./images'),
    frozen: await import('../core/frozen'),
    cards: await import('../core/cards'),
  };
}

const enc = (s: string) => new TextEncoder().encode(s);

/** Everything visible on the printed cards of the active game, with images as their bytes */
async function printedView(m: Mods, nos?: number[]) {
  const g = m.store.getGame()!;
  const set = (await m.cardSet.ensureCardSet(g))!;
  const g2 = m.store.getGame()!;
  const img = async (ref?: string) => {
    if (!ref) return 'none';
    const b = await m.images.getImageBlob(ref);
    return b ? Buffer.from(await b.arrayBuffer()).toString('base64') : 'badge';
  };
  const sym = async (it: SymbolItem) => `${it.label}|${it.speech ?? ''}|${await img(it.image)}`;
  const list = nos ? nos.map((n) => set.byNo.get(n)!) : set.cards;
  return {
    setCode: g2.frozen!.setCode,
    name: g2.config.eventName,
    date: g2.config.eventDate ?? '',
    logo: await img(g2.config.eventLogo),
    headers: await Promise.all(g2.config.columns.map(sym)),
    items: await Promise.all(g2.config.items.map(sym)),
    cards: list.map((c) => `${m.cards.formatCardNo(c.no)} ${c.cells.join(',')} ${m.frozen.cardCode(g2, c)}`),
  };
}

type Case = { size: CardSize; mode: SymbolMode; free: boolean; collide?: boolean; count?: number };

async function makeGameOnA(m: Mods, c: Case) {
  const g0 = m.store.createGame();
  const patch: Partial<GameConfig> = { size: c.size, mode: c.mode, freeCenter: c.free, cardCount: c.count ?? 40, eventName: 'งานเลี้ยงปีใหม่ ทดสอบ', eventDate: '31 ธ.ค. 2569' };
  const cells = c.size * c.size - (c.free && c.size % 2 ? 1 : 0);
  if (c.mode === 'image') {
    // uploaded images (random idb keys)
    const n = c.collide ? cells + 3 : cells + 12;
    const items: SymbolItem[] = [];
    for (let i = 0; i < n; i++) items.push({ id: 'u' + i, label: `รูปที่ ${i + 1}`, image: await m.images.saveImage(new Blob([enc(`uploaded image ${i}`)], { type: 'image/png' })) });
    Object.assign(patch, { items, poolMin: 1, poolMax: n });
  } else {
    const per = c.collide ? 4 : { 3: 10, 4: 12, 5: 15, 6: 15 }[c.size];
    Object.assign(patch, { poolMin: 1, poolMax: per * c.size });
    if (c.mode === 'columnLogo') {
      // bundled logos in a reordered column order + one uploaded logo
      const order = [...SEAGATE].reverse().slice(0, c.size);
      const columns: SymbolItem[] = order.map((id) => ({ id, label: id, speech: 'อ่าน ' + id, image: `/assets/symbols/seagate/${id}.png` }));
      columns[1] = { id: 'custom', label: 'Custom', image: await m.images.saveImage(new Blob([enc('uploaded column logo')], { type: 'image/png' })) };
      patch.columns = columns;
    }
  }
  m.store.dispatch({ type: 'UPDATE_CONFIG', patch });
  const res = await m.cardSet.generateNewSet(g0, m.store.getGame()!.config);
  m.store.dispatch({ type: 'GENERATE', ...res });
  if (c.collide) expect(Object.keys(m.store.getGame()!.attempts).length, 'collision forced').toBeGreaterThan(0);
  return m.store.getGame()!;
}

/** Machine B: other time zone, junk in IndexedDB (other keys, other order), locale APIs poisoned */
async function bootMachineB() {
  bootMachine(assetsB);
  process.env.TZ = 'America/New_York';
  const { set } = await import('idb-keyval');
  const keys = Array.from({ length: 30 }, (_, i) => `img_${(i * 7919) % 97}_${i}`).sort(() => 0.5 - ((Math.sin(keys_seed++) + 1) / 2));
  for (const k of keys) await set(k, new Blob([enc('other machine image ' + k)], { type: 'image/png' }));
  vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
    throw new Error('localeCompare used');
  });
  return mods();
}
let keys_seed = 1;

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TZ;
});

async function exportImport(c: Case, nos?: number[]) {
  bootMachine(assetsA);
  const a = await mods();
  await makeGameOnA(a, c);
  const before = await printedView(a, nos);
  const file = await a.backup.buildBackupText(a.store.getGame()!);

  const b = await bootMachineB();
  const p = await b.backup.prepareImport(file);
  expect(p.conflict).toBeNull();
  expect(p.selfCheckOk).toBe(true);
  const imported = await b.backup.commitImport(p);
  expect(imported.frozen!.backupPending).toBe(false);
  const after = await printedView(b, nos);
  return { before, after, file, b };
}

describe('export -> wipe -> import on another machine gives identical cards', () => {
  const cases: Case[] = [];
  for (const size of [3, 4, 5, 6] as CardSize[])
    for (const mode of ['number', 'columnLogo', 'image'] as SymbolMode[]) for (const free of [true, false]) cases.push({ size, mode, free });
  for (const mode of ['number', 'columnLogo', 'image'] as SymbolMode[]) cases.push({ size: 3, mode, free: true, collide: true, count: 60 });

  for (const c of cases) {
    it(`${c.size}x${c.size} ${c.mode} free=${c.free}${c.collide ? ' (forced collisions)' : ''}`, async () => {
      const { before, after } = await exportImport(c);
      expect(after).toEqual(before);
      // the bundled logos printed on machine A are used, not machine B's different/missing files
      if (c.mode === 'columnLogo') expect(after.headers[0]).toContain(Buffer.from('nytro logo A').toString('base64'));
    });
  }

  it('1000 cards: #0001, #0500 and #1000 identical', async () => {
    const { before, after } = await exportImport({ size: 5, mode: 'columnLogo', free: true, count: 1000 }, [1, 500, 1000]);
    expect(after).toEqual(before);
    expect(after.cards).toHaveLength(3);
  });
});

describe('import validation', () => {
  async function v2File() {
    bootMachine(assetsA);
    const a = await mods();
    await makeGameOnA(a, { size: 5, mode: 'image', free: true });
    return { a, text: await a.backup.buildBackupText(a.store.getGame()!) };
  }

  it('rejects a backup with one changed cell', async () => {
    const { text } = await v2File();
    const j = JSON.parse(text);
    const { base64ToBytes, bytesToBase64 } = await import('../core/bytes');
    const raw = base64ToBytes(j.cards.data);
    raw[0] = raw[0] === 1 ? 2 : 1;
    j.cards.data = bytesToBase64(raw);
    const b = await bootMachineB();
    await expect(b.backup.prepareImport(JSON.stringify(j))).rejects.toThrow(b.backup.T_TAMPERED);
  });

  it('rejects an edited image, an edited set code and an edited label', async () => {
    const { text } = await v2File();
    const b = await bootMachineB();
    const img = JSON.parse(text);
    const k = Object.keys(img.images)[0];
    img.images[k] = 'data:image/png;base64,' + Buffer.from('swapped').toString('base64');
    await expect(b.backup.prepareImport(JSON.stringify(img))).rejects.toThrow(b.backup.T_TAMPERED);
    const code = JSON.parse(text);
    code.setCode = code.game.frozen.setCode = 'AAAA-AAAA';
    await expect(b.backup.prepareImport(JSON.stringify(code))).rejects.toThrow(b.backup.T_TAMPERED);
    const label = JSON.parse(text);
    label.game.config.items[3].label = 'แก้ชื่อ';
    await expect(b.backup.prepareImport(JSON.stringify(label))).rejects.toThrow(b.backup.T_TAMPERED);
  });

  it('keeps the snapshot (and logs a warning) if regenerating from the seed disagrees', async () => {
    const { a, text } = await v2File();
    const before = await printedView(a);
    const j = JSON.parse(text);
    j.game.attempts = { 3: 5 }; // not covered by the set code: regeneration would differ
    const b = await bootMachineB();
    const p = await b.backup.prepareImport(JSON.stringify(j));
    expect(p.selfCheckOk).toBe(false);
    const g = await b.backup.commitImport(p);
    expect(g.log.some((l) => l.type === 'warning')).toBe(true);
    expect(await printedView(b)).toEqual(before);
  });

  it('Replace / Keep both when the same game id already exists', async () => {
    const { text } = await v2File();
    const b = await bootMachineB();
    const first = await b.backup.commitImport(await b.backup.prepareImport(text));
    b.store.dispatch({ type: 'DRAW', ball: 1, winners: [] });
    // keep both
    const p2 = await b.backup.prepareImport(text);
    expect(p2.conflict).toMatchObject({ setCode: first.frozen!.setCode, draws: 1 });
    const both = await b.backup.commitImport(p2, 'keepBoth');
    expect(both.id).not.toBe(first.id);
    expect(both.label).toBe(first.config.eventName + b.backup.IMPORTED_SUFFIX);
    expect(both.config.eventName).toBe(first.config.eventName); // printed name unchanged
    expect(b.store.listGames().map((x) => x.setCode)).toEqual([first.frozen!.setCode, first.frozen!.setCode]);
    const viewBoth = await printedView(b);
    // replace
    const p3 = await b.backup.prepareImport(text);
    const rep = await b.backup.commitImport(p3, 'replace');
    expect(rep.id).toBe(first.id);
    expect(rep.draws).toEqual([]);
    expect(b.store.listGames()).toHaveLength(2);
    expect(await printedView(b)).toEqual(viewBoth);
  });
});

describe('migration of games created before this update', () => {
  it('an existing v1 game gets a snapshot identical to v1 output on this machine', async () => {
    bootMachine(assetsA);
    // what the previous app version stored: no `frozen`, index entry without the new fields
    const { defaultConfig } = await import('../core/game');
    const { buildAttemptMap, getAllCards, checkCode } = await import('../core/cards');
    const cfg = { ...defaultConfig(), size: 4 as CardSize, freeCenter: false, poolMin: 1, poolMax: 48, cardCount: 120 };
    const attempts = buildAttemptMap(cfg, 'old-seed');
    const rec = { schemaVersion: 2, id: 'gOLD', createdAt: 1, updatedAt: 2, config: cfg, seed: 'old-seed', attempts, locked: true, draws: [5, 9], winners: [], currentRound: 0, paused: false, status: 'playing', settings: {}, log: [] };
    localStorage.setItem('bingo:game:gOLD', JSON.stringify(rec));
    localStorage.setItem('bingo:index', JSON.stringify([{ id: 'gOLD', name: 'old', createdAt: 1, updatedAt: 2, size: 4, cardCount: 120, status: 'playing' }]));
    localStorage.setItem('bingo:active', 'gOLD');
    const m = await mods();
    expect(await m.cardSet.migrateAllGames()).toBe(1);
    const g = m.store.getGame()!;
    expect(g.frozen).toMatchObject({ generatorVersion: 1, origin: 'migrated', verified: true, backupPending: true });
    expect(g.draws).toEqual([5, 9]);
    const set = (await m.cardSet.ensureCardSet(g))!;
    const v1 = getAllCards(cfg, 'old-seed', attempts);
    expect(set.cards).toEqual(v1);
    v1.forEach((c) => expect(m.frozen.cardCode(g, c)).toBe(checkCode('old-seed', c.no))); // printed codes unchanged
    expect(g.config.eventLogo).toMatch(/^idb:sha_/); // the logo this machine printed is frozen too
    expect(m.store.listGames()[0]).toMatchObject({ setCode: g.frozen!.setCode, verified: true, backupPending: true });
    expect(await m.cardSet.migrateAllGames()).toBe(0); // only once
    m.store.dispatch({ type: 'BACKUP_DONE' });
    expect(m.store.getGame()!.frozen!.backupPending).toBe(false);
  });

  it('a lost snapshot is rebuilt only if it reproduces the set code', async () => {
    bootMachine(assetsA);
    const m = await mods();
    await makeGameOnA(m, { size: 5, mode: 'number', free: true });
    const before = await printedView(m);
    const { del } = await import('idb-keyval');
    await del('cards:' + m.store.getGame()!.id);
    vi.resetModules();
    const m2 = await mods();
    expect(await printedView(m2)).toEqual(before);
  });
});

describe('old (v1) backup files', () => {
  async function v1Backup(withBundled: boolean) {
    bootMachine(assetsA);
    const m = await mods();
    const { buildAttemptMap, getAllCards, checkCode } = await import('../core/cards');
    const { createBackup, serializeBackup } = await import('../core/backup');
    const { blobToDataURL } = m.images;
    m.store.createGame();
    const logo = withBundled ? '/assets/brand/event-logo.svg' : await m.images.saveImage(new Blob([enc('uploaded logo')], { type: 'image/png' }));
    const items: SymbolItem[] = [];
    for (let i = 0; i < 30; i++) items.push({ id: 'u' + i, label: 'img' + i, image: await m.images.saveImage(new Blob([enc('v1 image ' + i)], { type: 'image/png' })) });
    m.store.dispatch({ type: 'UPDATE_CONFIG', patch: { mode: 'image', items, poolMin: 1, poolMax: 30, eventLogo: logo } });
    const cfg = m.store.getGame()!.config;
    const attempts = buildAttemptMap(cfg, 'v1-seed');
    // the old GENERATE: seed + attempts only, no snapshot
    const old = { ...m.store.getGame()!, seed: 'v1-seed', attempts, locked: true, status: 'ready' as const };
    const images: Record<string, string> = {};
    for (const ref of [logo, ...items.map((i) => i.image!)]) {
      if (!ref.startsWith('idb:')) continue;
      images[ref.slice(4)] = await blobToDataURL((await m.images.getImageBlob(ref))!);
    }
    const printed = getAllCards(cfg, 'v1-seed', attempts).map((c) => c.cells.join(',') + ' ' + checkCode('v1-seed', c.no));
    return { text: serializeBackup(createBackup(old, images, 0)), printed, items };
  }

  it('a v1 file with all images inside reproduces the original cards exactly (verified)', async () => {
    const { text, printed, items } = await v1Backup(false);
    const b = await bootMachineB();
    const p = await b.backup.prepareImport(text);
    expect(p.verified).toBe(true);
    expect(p.warnings).toEqual([]);
    const g = await b.backup.commitImport(p);
    const set = (await b.cardSet.ensureCardSet(g))!;
    expect(set.cards.map((c) => c.cells.join(',') + ' ' + b.frozen.cardCode(g, c))).toEqual(printed);
    const img = await b.images.getImageBlob(g.config.items[7].image!);
    expect(Buffer.from(await img!.arrayBuffer()).toString()).toBe('v1 image 7');
    expect(g.config.items.map((i) => i.label)).toEqual(items.map((i) => i.label));
    expect(b.store.listGames()[0]).toMatchObject({ verified: true, backupPending: true });
  });

  it('a v1 file that relies on the app folder imports with the warning and is marked unverified', async () => {
    const { text, printed } = await v1Backup(true);
    const b = await bootMachineB();
    const p = await b.backup.prepareImport(text);
    expect(p.verified).toBe(false);
    expect(p.warnings[0]).toBe(b.backup.T_OLD_BACKUP);
    const g = await b.backup.commitImport(p);
    expect(g.frozen).toMatchObject({ verified: false, generatorVersion: 1 });
    expect(b.store.listGames()[0].verified).toBe(false);
    const set = (await b.cardSet.ensureCardSet(g))!;
    expect(set.cards.map((c) => c.cells.join(',') + ' ' + b.frozen.cardCode(g, c))).toEqual(printed); // cells/codes still exact
  });

  it('a removed logo stays removed (no default re-applied) for frozen games', async () => {
    bootMachine(assetsA);
    const a = await mods();
    a.store.createGame();
    a.store.dispatch({ type: 'UPDATE_CONFIG', patch: { eventLogo: '' } });
    const res = await a.cardSet.generateNewSet(a.store.getGame()!);
    a.store.dispatch({ type: 'GENERATE', ...res });
    const text = await a.backup.buildBackupText(a.store.getGame()!);
    const b = await bootMachineB();
    const g = await b.backup.commitImport(await b.backup.prepareImport(text));
    expect(g.config.eventLogo).toBe('');
    vi.resetModules();
    const { loadGame } = await import('./gameStore');
    expect(loadGame(g.id)!.config.eventLogo).toBe(''); // and after a reload
  });
});

describe('play again with the same cards', () => {
  it('clears draws/winners, keeps snapshot, set code and check codes', async () => {
    bootMachine(assetsA);
    const m = await mods();
    await makeGameOnA(m, { size: 5, mode: 'number', free: true });
    const before = await printedView(m);
    for (const ball of [1, 2, 3, 4, 5]) m.store.dispatch({ type: 'DRAW', ball, winners: ball === 5 ? [1] : [] });
    m.store.dispatch({ type: 'END_GAME' });
    m.store.dispatch({ type: 'RESTART_SAME_CARDS' });
    const g = m.store.getGame()!;
    expect(g).toMatchObject({ draws: [], winners: [], currentRound: 0, status: 'ready', locked: true });
    expect(await printedView(m)).toEqual(before);
  });
});
