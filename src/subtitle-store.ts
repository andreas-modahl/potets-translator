import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { MAX_SUBTITLE_MS, SubtitleError, type SubtitleCue } from './subtitles.js';

export interface SavedSubtitles { id: string; title: string; source: string; cues: SubtitleCue[]; updated: string }
export function validateSaved(value: unknown): { title: string; source: string; cues: SubtitleCue[] } {
  if (!value || typeof value !== 'object') throw new SubtitleError('Ugyldige undertekster.', 400);
  const data = value as Record<string, unknown>;
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 200 ||
      typeof data.source !== 'string' || data.source.length > 255 || !Array.isArray(data.cues) ||
      !data.cues.length || data.cues.length > 3000 || Buffer.byteLength(JSON.stringify(data)) > 2_000_000) {
    throw new SubtitleError('Ugyldig tittel eller undertekstfil (maks 2 MB).', 400);
  }
  let end = 0;
  for (const cue of data.cues) {
    if (!cue || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 5000 ||
        typeof cue.turkish !== 'string' || cue.turkish.length > 5000 || !Number.isFinite(cue.start) ||
        !Number.isFinite(cue.end) || cue.start < end || Math.round(cue.end) <= Math.round(cue.start) || cue.end > MAX_SUBTITLE_MS) {
      throw new SubtitleError('Undertekstene må ha tekst og gyldige tider uten overlapp.', 400);
    }
    end = cue.end;
    for (const parts of [cue.words, cue.chunks]) {
      if (!Array.isArray(parts) || parts.length > 1000) throw new SubtitleError('Ordtider mangler.', 400);
      let partEnd = 0;
      for (const part of parts) {
        if (!part || typeof part.text !== 'string' || !part.text.trim() || part.text.length > 5000 ||
            !Number.isFinite(part.start) || !Number.isFinite(part.end) || part.start < partEnd ||
            part.end <= part.start || part.end > MAX_SUBTITLE_MS) throw new SubtitleError('Ugyldige ordtider.', 400);
        partEnd = part.end;
      }
    }
  }
  return { title: data.title.trim(), source: data.source, cues: data.cues as SubtitleCue[] };
}

export class SubtitleStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS saved_subtitles (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL,
        cues TEXT NOT NULL, updated TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS saved_subtitles_owner ON saved_subtitles(owner, updated);`);
  }
  list(owner: string) {
    return this.db.prepare('SELECT id,title,source,updated FROM saved_subtitles WHERE owner=? ORDER BY updated DESC').all(owner);
  }
  get(owner: string, id: string): SavedSubtitles | undefined {
    const row = this.db.prepare('SELECT id,title,source,cues,updated FROM saved_subtitles WHERE owner=? AND id=?').get(owner, id) as
      | { id: string; title: string; source: string; cues: string; updated: string }
      | undefined;
    return row ? { ...row, cues: JSON.parse(row.cues) } : undefined;
  }
  save(owner: string, value: unknown, id: string = randomUUID()): SavedSubtitles {
    const data = validateSaved(value);
    const other = this.db.prepare('SELECT owner FROM saved_subtitles WHERE id=?').get(id);
    if (other && other.owner !== owner) throw new SubtitleError('Fant ikke undertekstene.', 404);
    const updated = new Date().toISOString();
    this.db.prepare(`INSERT INTO saved_subtitles(id,owner,title,source,cues,updated) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,source=excluded.source,cues=excluded.cues,updated=excluded.updated`)
      .run(id, owner, data.title, data.source, JSON.stringify(data.cues), updated);
    return { id, ...data, updated };
  }
  close() { this.db.close(); }
}
