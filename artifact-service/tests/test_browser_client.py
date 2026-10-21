import subprocess
import unittest
from pathlib import Path


class BrowserClientTests(unittest.TestCase):
    def test_refresh_events_fallback_empty_state_and_failed_fetch(self):
        script = Path(__file__).parents[1] / "src/battuta_artifacts/assets/catalog.js"
        # Stub only browser boundaries; execute the shipped client unchanged.
        javascript = r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// Only DOM/network boundaries are stubbed. Real-browser checks cover layout/focus.
const node = tag => ({tag, textContent: '', children: [], dataset: {},
  append(...children) {this.children.push(...children)},
  replaceChildren(...children) {this.children = children},
  insertBefore(child, next) {
    this.children = this.children.filter(item => item !== child);
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, child);
  },
  remove() {body.children = body.children.filter(child => child !== this)},
  contains(target) {return target === this || Object.values(this.fields || {}).includes(target) || this.children.some(child => child.contains(target))},
  querySelector(selector) {return this.fields[selector]},
  focus() {document.activeElement = this}
});
const row = () => {
  const item = node('li');
  item.fields = {'.artifact-link':node('a'),'.artifact-title':node('span'),'.artifact-description':node('p'),'time':node('time')};
  return item;
};
const body = node('ul'), status = node('p'), count = node('span'), empty = node('p');
const template = {content:{firstElementChild:{cloneNode:row}}};
const elements = {artifacts:body, status, 'artifact-count':count, 'empty-state':empty, 'artifact-template':template};
const document = {activeElement:null, getElementById:id => elements[id], createElement:node};
let event, interval, hide, calls = 0, fail = false;
let artifacts = [{slug:'demo',url:'/artifacts/a/demo/',title:'<script>bad</script>',description:'Description',format:'html',updated_at:'2026-10-21T00:30:00+00:00'}];
vm.runInNewContext(readFileSync(process.argv[1], 'utf8'), {
  document,
  EventSource:class {
    constructor(url) {assert.equal(url,'/artifacts/events'); event=this;}
    addEventListener(name, fn) {assert.equal(name,'catalog-changed');this.change=fn;}
    close() {this.closed=true;}
  },
  window:{addEventListener:(name, fn) => {assert.equal(name,'pagehide');hide=fn;}},
  setInterval:(fn, milliseconds) => {assert.equal(milliseconds,5000);interval=fn;},
  fetch:async (url, options) => {
    calls++; assert.equal(url,'/artifacts/catalog');assert.equal(options.cache,'no-store');
    return {ok:!fail,json:async()=>({artifacts})};
  }
});
await event.onopen();
assert.equal(body.children[0].fields['.artifact-title'].textContent,'<script>bad</script>');
assert.equal(body.children[0].fields['.artifact-link'].href,'/artifacts/a/demo/');
assert.equal(body.children[0].fields.time.textContent,'21 Oct 2026');
assert.equal(body.children[0].fields.time.dateTime,'2026-10-21T00:30:00+00:00');
assert.equal(count.textContent,'1 work');
const original = body.children[0];
original.fields['.artifact-link'].focus();
await interval();
assert.equal(body.children[0],original,'unchanged refresh keeps the existing row');
artifacts[0].description='Revised description';
await event.change();
assert.equal(body.children[0],original,'metadata changes update the row in place');
assert.equal(document.activeElement,original.fields['.artifact-link']);
assert.equal(original.fields['.artifact-description'].textContent,'Revised description');
fail=true;
await interval();
assert.match(status.textContent,/unavailable/);
assert.equal(body.children[0],original,'failed fetch preserves visible entries');
fail=false;
const other = {...artifacts[0],slug:'other',url:'/artifacts/a/other/',title:'Other'};
artifacts.push(other);
await event.change();
assert.equal(count.textContent,'2 works');
artifacts=[other];
await event.change();
assert.equal(document.activeElement,body,'removing one focused entry focuses the surviving list');
artifacts=[];
await event.change();
assert.equal(body.children.length,0);
assert.equal(empty.hidden,false);
assert.equal(count.textContent,'0 works');
assert.equal(document.activeElement,empty,'removing the last focused entry focuses the empty message');
artifacts=[other];
await event.change();
assert.equal(document.activeElement,body.children[0].fields['.artifact-link'],'repopulation does not hide the focused empty message');
assert.equal(status.textContent,'');
assert.equal(calls,8);
hide();assert.equal(event.closed,true);
"""
        result = subprocess.run(["node", "--input-type=module", "-e", javascript, str(script)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
