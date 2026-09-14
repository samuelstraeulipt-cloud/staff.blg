/* BLG TeamHub — one-time collection builder. Run once, then delete this file.
   The Collections API refuses to run as an ordinary site visitor, so both calls
   are elevated to run with the site owner's rights. */
import { Permissions, webMethod } from 'wix-web-module';
import { collections } from 'wix-data.v2';
import { elevate } from 'wix-auth';

const createCollection = elevate(collections.createDataCollection);
const listAll = elevate(collections.listDataCollections);

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
      await createCollection({ ...def, permissions: ADMIN_ONLY });
      report.push(def._id + ': created');
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 140);
      if (/already exists|ALREADY_EXISTS|duplicate/i.test(msg)) {
        report.push(def._id + ': exists');
      } else {
        report.push(def._id + ': FAILED - ' + msg);
      }
    }
  }
  return report;
});

export const listCollections = webMethod(Permissions.Anyone, async () => {
  const res = await listAll();
  return (res.collections || [])
    .filter(c => c.collectionType === 'NATIVE')
    .map(c => c._id + ' [' + (c.fields || [])
      .filter(f => !f.systemField).map(f => f.key).join(', ') + ']');
});
