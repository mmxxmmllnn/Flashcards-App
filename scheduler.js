/*
Purpose: Small SM-2 variant scheduler used by Study view.
Concepts:
- Each review gives a "grade": again | hard | good | easy
- We track: ease (E-Factor), interval (days), reps (successful reviews), lapses (failures), due (Date)
- Starting values: ease=2.5, interval=0, reps=0, lapses=0, state='new'
- This variant is simplified: we treat everything as day-based (no minute learning steps).
  You can later add "learning steps" if you want.
Rules (classic SM-2-ish):
- If "again": increment lapses, set reps=0, interval=1 day, ease=Math.max(1.3, ease-0.2)
- If "hard": interval = max(1, round(interval*1.2)), ease=Math.max(1.3, ease-0.15), reps+=1
- If "good":
    if reps==0 -> interval=1
    else if reps==1 -> interval=6
    else interval=round(interval * ease)
    ease stays the same (or small +0.0)
    reps+=1
- If "easy": interval=round(interval * (ease+0.2)) or for new cards -> 4 days
    ease += 0.15 (cap at ~3.0+ for sanity if you want)
    reps+=1
- due = now + interval days
Why rounded days? Simplicity: we don't store times-of-day complexity for this MVP.
*/

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function schedule(card, grade, nowDate=new Date()) {
  const c = { ...card }; // copy
  let interval = c.interval || 0;
  let ease = c.ease || 2.5;
  let reps = c.reps || 0;
  let lapses = c.lapses || 0;

  switch (grade) {
    case 'again':
      lapses += 1;
      reps = 0;
      ease = Math.max(1.3, ease - 0.2);
      interval = 1;
      break;
    case 'hard':
      ease = Math.max(1.3, ease - 0.15);
      interval = Math.max(1, Math.round(Math.max(1, interval) * 1.2));
      reps += 1;
      break;
    case 'good':
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.max(1, Math.round(interval * ease));
      // ease unchanged
      reps += 1;
      break;
    case 'easy':
      ease = Math.min(3.5, ease + 0.15); // soft cap
      if (reps === 0) interval = 4;
      else interval = Math.max(1, Math.round(interval * (ease + 0.2)));
      reps += 1;
      break;
    default:
      throw new Error('Unknown grade');
  }

  const due = new Date(nowDate);
  due.setDate(due.getDate() + interval);

  return {
    ...c,
    ease: ease,
    interval: interval,
    reps: reps,
    lapses: lapses,
    due: due,
    state: 'review'
  };
}

// Tiny console test helper
function _assert(name, cond) {
  if (!cond) throw new Error('Test failed: ' + name);
  console.log('✓', name);
}

// Run a few example tests on load (safe/no-op if you ignore console)
(function schedulerTests(){
  const base = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: new Date(), state:'new' };

  // New card Good: interval should be 1, reps=1
  let c1 = schedule(base, 'good', new Date('2025-01-01'));
  _assert('new good -> int=1', c1.interval === 1 && c1.reps === 1);

  // Next Good: interval should be 6, reps=2
  let c2 = schedule(c1, 'good', new Date('2025-01-02'));
  _assert('2nd good -> int=6', c2.interval === 6 && c2.reps === 2);

  // Again should reset reps and interval 1
  let c3 = schedule(c2, 'again', new Date('2025-01-08'));
  _assert('again -> int=1,reps=0,lapses=1', c3.interval === 1 && c3.reps === 0 && c3.lapses === 1);

  // Easy on new: 4 days
  let c4 = schedule(base, 'easy', new Date('2025-01-01'));
  _assert('new easy -> int=4', c4.interval === 4 && c4.reps === 1);

  // Hard reduces ease
  let e0 = c2.ease;
  let c5 = schedule(c2, 'hard', new Date('2025-01-02'));
  _assert('hard lowers ease', c5.ease <= e0);
})();

// Expose
window.scheduler = { schedule, daysFromNow };