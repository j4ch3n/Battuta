import subprocess
import unittest
from pathlib import Path


class BrowserClientTests(unittest.TestCase):
    def test_grouping_refresh_focus_empty_state_and_failed_fetch(self):
        script = Path(__file__).parents[1] / "src/battuta_artifacts/assets/catalog.js"
        # Stub only browser boundaries; execute the shipped client unchanged.
        javascript = r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const node = (tag, className = '') => ({tag, className, textContent: '', children: [], dataset: {}, open: false,
  append(...children) {for (const child of children) this.insertBefore(child, null)},
  insertBefore(child, next) {
    child.remove();
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, child); child.parentElement = this;
  },
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  },
  matches(selector) {return selector.startsWith('.') ? this.className === selector.slice(1) : this.tag === selector},
  closest(selector) {return this.matches(selector) ? this : this.parentElement?.closest(selector)},
  contains(target) {return target === this || this.children.some(child => child.contains(target))},
  querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)])},
  querySelector(selector) {return this.querySelectorAll(selector)[0]},
  addEventListener(name, fn) {this[name] = fn},
  removeAttribute(name) {if (name === 'datetime') delete this.dateTime},
  focus() {document.activeElement = this}
});
const row = () => {
  const item = node('li', 'artifact'), link = node('a', 'artifact-link');
  item.append(link);
  link.append(node('h3', 'artifact-title'), node('p', 'artifact-description'), node('time'));
  return item;
};
const project = () => {
  const item = node('li', 'project'), details = node('details'), summary = node('summary', 'project-summary');
  item.append(details); details.append(summary, node('ul', 'artifact-list'));
  summary.append(node('h2', 'project-name'), node('span', 'project-count'));
  return item;
};
const body = node('ul'), status = node('p'), count = node('span'), empty = node('p');
const template = factory => ({content:{firstElementChild:{cloneNode:factory}}});
const elements = {artifacts:body, status, 'artifact-count':count, 'empty-state':empty,
  'artifact-template':template(row), 'project-template':template(project)};
const document = {activeElement:null, getElementById:id => elements[id]};
let event, interval, hide, calls = 0, fail = false;
let artifacts = [{slug:'demo',project:'Alpha',url:'/artifacts/a/demo/',title:'<script>bad</script>',description:'Description',updated_at:'2026-10-21T00:30:00+00:00'}];
vm.runInNewContext(readFileSync(process.argv[1], 'utf8'), {
  document,
  EventSource:class {
    constructor(url) {assert.equal(url,'/artifacts/events'); event=this;}
    addEventListener(name, fn) {assert.equal(name,'catalog-changed');this.change=fn;}
    close() {this.closed=true;}
  },
  window:{
    matchMedia:() => ({matches:true, addEventListener(){}}),
    addEventListener:(name, fn) => {assert.equal(name,'pagehide');hide=fn;}
  },
  setInterval:(fn, milliseconds) => {assert.equal(milliseconds,5000);interval=fn;},
  fetch:async (url, options) => {
    calls++; assert.equal(url,'/artifacts/catalog');assert.equal(options.cache,'no-store');
    return {ok:!fail,json:async()=>({artifacts})};
  }
});
await event.onopen();
const original = body.querySelector('.artifact'), group = body.children[0], details = group.querySelector('details');
assert.equal(original.querySelector('.artifact-title').textContent,'<script>bad</script>');
assert.equal(original.querySelector('.artifact-link').href,'/artifacts/a/demo/');
assert.equal(original.querySelector('time').textContent,'21 Oct 2026');
assert.equal(count.textContent,'1 work');
assert.equal(details.open,false,'new groups start collapsed');
details.open = true;
original.querySelector('.artifact-link').focus();
await interval();
assert.equal(body.querySelector('.artifact'),original,'unchanged refresh keeps the existing row');
assert.equal(body.children[0],group);
assert.equal(details.open,true,'polling retains disclosure state');
artifacts[0].description='Revised description';
await event.change();
assert.equal(document.activeElement,original.querySelector('.artifact-link'));
assert.equal(original.querySelector('.artifact-description').textContent,'Revised description');
fail=true;
await interval();
assert.match(status.textContent,/unavailable/);
assert.equal(body.querySelector('.artifact'),original,'failed fetch preserves visible entries');
fail=false;
const other = {...artifacts[0],slug:'other',url:'/artifacts/a/other/',title:'Other'};
artifacts.push(other);
await event.change();
assert.equal(count.textContent,'2 works');
artifacts=[other];
await event.change();
assert.equal(document.activeElement,body,'removing a focused entry focuses the surviving list');
artifacts=[];
await event.change();
assert.equal(body.children.length,0);
assert.equal(empty.hidden,false);
assert.equal(count.textContent,'0 works');
assert.equal(document.activeElement,empty);
artifacts=[other];
await event.change();
assert.equal(document.activeElement,body.children[0].querySelector('summary'),'repopulation focuses the first disclosure');
assert.equal(status.textContent,'');
assert.equal(calls,8);
// Dates, alphabetical projects, deterministic ties and missing-date ordering.
artifacts = [
 {...other,slug:'older',project:'zeta',updated_at:'2025-01-01T00:00:00Z'},
 {...other,slug:'missing-z',updated_at:null},
 {...other,slug:'newest',updated_at:'2026-10-22T00:00:00Z'},
 {...other,slug:'missing-a',updated_at:'bad'},
 {...other,slug:'tie-z',updated_at:'2026-10-21T00:30:00Z'},
 {...other,slug:'tie-a',updated_at:'2026-10-21T01:30:00+01:00'},
 {...other,slug:'unassigned',project:null,updated_at:null}
];
await event.change();
assert.deepEqual(body.children.map(item => item.querySelector('.project-name').textContent),['Alpha','Unassigned','zeta']);
assert.deepEqual(body.children[0].querySelectorAll('.artifact').map(item => item.dataset.slug),['newest','tie-a','tie-z','missing-a','missing-z']);
const undated = body.children[0].querySelectorAll('.artifact')[3].querySelector('time');
assert.equal(undated.textContent,'Date unavailable');
assert.equal(undated.dateTime,undefined);
// Moving a focused artifact to a collapsed project focuses its summary, not a hidden link.
const moving = body.querySelector('.artifact');
body.children[0].querySelector('details').open = true;
moving.querySelector('.artifact-link').focus();
artifacts.find(item => item.slug === 'newest').project = 'zeta';
await event.change();
assert.equal(document.activeElement,body.children[2].querySelector('summary'));
hide();assert.equal(event.closed,true);
"""
        result = subprocess.run(["node", "--input-type=module", "-e", javascript, str(script)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
