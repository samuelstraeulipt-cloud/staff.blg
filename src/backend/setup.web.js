/* BLG TeamHub — one-time collection builder. Run once, then delete this file.
   Running it twice is harmless: existing collections are reported and left alone. */
import { Permissions, webMethod } from 'wix-web-module';
import { collections } from 'wix-data.v2';

const T = (key, displayName) => ({ key, displayName, type: 'TEXT' });
const N = (key, displayName) => ({ key, displayName, type: 'NUMBER' });
const B = (key, displayName) => ({ key, displayName, type: 'BOOLEAN' });

const ADMIN_ONLY = { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' };

const SCHEMA = [
  { _id: 'Staff', displayName: 'Staff', fields: [
    T('title', 'Name'), T('email', 'Email'), T('roles', 'Roles'),
    T('disciplines', 'Disciplines'), T('colour', 'Colour'),
    T('memberId', 'Member ID'), B('active', 'Active') ] },
  { _id: 'Classes', displayName: 'Classes', fields: [
    T('title', 'Class'), N('weekday', 'Weekday (1=Mon)'), T('start', 'Start'),
    N('minutes', 'Minutes'), T('discipline', 'Discipline'),
    T('coachEmail', 'Coach email'), B('active', 'Active') ] },
  { _id: 'Shifts', displayName: 'Shifts', fields: [
    T('title', 'Code'), T('label', 'Label'), N('weekday', 'Weekday (1=Mon)'),
    T('start', 'Start'), T('end', 'End'), N('hours', 'Planned hours'),
    B('active', 'Active') ] },
  { _id: 'ShiftAssignments', displayName: 'Shift assignments', fields: [
    T('title', 'Key'), T('date', 'Date (YYYY-MM-DD)'), T('shiftId', 'Shift ID'),
    T('staffEmail', 'Staff email') ] },
  { _id: 'Sessions', displayName: 'Sessions handed over', fields: [
    T('title', 'Key'), T('kind', 'Kind'), T('refId', 'Ref ID'), T('date', 'Date'),
    T('ownerId', 'Owner'), T('status', 'Status'), T('coveredById', 'Covered by') ] },
  { _id: 'CoverRequests', displayName: 'Cover requests', fields: [
    T('title', 'Key'), T('sessionId', 'Session'), T('staffId', 'Staff'),
    T('kind', 'Kind'), T('status', 'Status') ] },
  { _id: 'ShiftOverrides', displayName: 'Shift hour overrides', fields: [
    T('title', 'Key'), T('shiftId', 'Shift ID'), T('date', 'Date'),
    N('hours', 'Hours worked') ] }
];

export const setupCollections = webMethod(Permissions.Anyone, async () => {
  const report = [];
  for (const def of SCHEMA) {
    try {
      await collections.createDataCollection({ ...def, permissions: ADMIN_ONLY });
      report.push(def._id + ': created');
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/already exists|ALREADY_EXISTS|duplicate/i.test(msg)) {
        report.push(def._id + ': exists');
        continue;
      }
      try {
        await collections.createDataCollection({ ...def, permissions: {
          read: 'SITE_MEMBER_AUTHOR', insert: 'SITE_MEMBER_AUTHOR',
          update: 'SITE_MEMBER_AUTHOR', remove: 'SITE_MEMBER_AUTHOR' } });
        report.push(def._id + ': created (fallback permissions)');
      } catch (err2) {
        report.push(def._id + ': FAILED - ' + msg);
      }
    }
  }
  return report;
});

export const listCollections = webMethod(Permissions.Anyone, async () => {
  const res = await collections.listDataCollections();
  return (res.collections || [])
    .filter(c => c.collectionType === 'NATIVE')
    .map(c => c._id + ' [' + (c.fields || [])
      .filter(f => !f.systemField).map(f => f.key).join(', ') + ']');
});
