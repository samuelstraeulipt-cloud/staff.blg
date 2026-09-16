/* A small in-memory stand-in for the three Wix modules, faithful to the parts
   the backend uses: queries are chainable, find() returns {items,totalCount},
   and get/insert/update/remove work on plain objects. */
export const Permissions = { SiteMember: 'SiteMember', Anyone: 'Anyone' };
export const webMethod = (perm, fn) => fn;

export const db = {};            // collection -> [rows]
let seq = 0;
const id = () => 'id' + (++seq);
export function seed(name, rows) {
  db[name] = rows.map(r => ({ _id: r._id || id(), _createdDate: new Date(), ...r }));
  return db[name];
}
export function reset() { Object.keys(db).forEach(k => delete db[k]); seq = 0; }

export let MEMBER = null;
export function setMember(m) { MEMBER = m; }
export const currentMember = {
  async getMember(opts) {
    if (!MEMBER) return null;
    const full = opts && (opts.fieldsets || []).includes('FULL');
    /* The real API only returns loginEmail in FULL — that is the whole bug. */
    return full ? { ...MEMBER } : { _id: MEMBER._id };
  }
};

export let CALLS = 0;
export function calls() { return CALLS; }
export function resetCalls() { CALLS = 0; }

class Q {
  constructor(name) { this.name = name; this.fs = []; this._limit = 50; this._asc = null; }
  eq(f, v) { this.fs.push(r => r[f] === v); return this; }
  ne(f, v) { this.fs.push(r => r[f] !== v); return this; }
  ge(f, v) { this.fs.push(r => String(r[f]) >= v); return this; }
  le(f, v) { this.fs.push(r => String(r[f]) <= v); return this; }
  hasSome(f, vs) { this.fs.push(r => vs.includes(r[f])); return this; }
  startsWith(f, v) { this.fs.push(r => String(r[f] || '').startsWith(v)); return this; }
  ascending(f) { this._asc = f; return this; }
  limit(n) { this._limit = n; return this; }
  async find() {
    CALLS++;
    let all = (db[this.name] || []).filter(r => this.fs.every(f => f(r)));
    if (this._asc) all = all.slice().sort((a, b) =>
      String(a[this._asc]).localeCompare(String(b[this._asc])));
    const items = all.slice(0, this._limit).map(r => ({ ...r }));
    /* Both signals the real result carries, so `findAll` can be tested using
       either one on its own. */
    return { items, totalCount: all.length, hasNext: () => all.length > items.length };
  }
}

const wixData = {
  query: name => new Q(name),
  async get(name, rid) { CALLS++; const r = (db[name] || []).find(x => x._id === rid); return r ? { ...r } : null; },
  async insert(name, row) { CALLS++; const r = { _id: id(), _createdDate: new Date(), ...row }; (db[name] ||= []).push(r); return { ...r }; },
  async bulkInsert(name, rows) {
    CALLS++;
    rows.forEach(row => (db[name] ||= []).push({ _id: id(), _createdDate: new Date(), ...row }));
    return { inserted: rows.length, skipped: 0, errors: [] };
  },
  /* REPLACES, it does not merge — which is what the real one does. A partial
     update like `update('Sessions', { _id, status })` silently wipes every
     other field in production; merging here would let that pass the suite. */
  async update(name, row) {
    CALLS++;
    const i = (db[name] || []).findIndex(x => x._id === row._id);
    if (i < 0) throw new Error('missing');
    const kept = db[name][i];
    db[name][i] = { _id: kept._id, _createdDate: kept._createdDate, ...row };
    return { ...db[name][i] };
  },
  async remove(name, rid) {
    CALLS++;
    const i = (db[name] || []).findIndex(x => x._id === rid);
    if (i < 0) return null;
    return db[name].splice(i, 1)[0];
  }
};
export default wixData;
