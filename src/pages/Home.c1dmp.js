/* Temporary: runs the one-time collection builder and prints the result to the
   developer console. Remove both this file's contents and backend/setup.web.js
   once the collections exist. */
import { setupCollections, listCollections } from 'backend/setup.web';

$w.onReady(async function () {
  try {
    const created = await setupCollections();
    console.log('SETUP_RESULT ' + JSON.stringify(created));
    const listed = await listCollections();
    console.log('SETUP_LIST ' + JSON.stringify(listed));
  } catch (e) {
    console.log('SETUP_ERROR ' + ((e && e.message) || e));
  }
});
