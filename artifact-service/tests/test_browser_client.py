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
const node = tag => ({tag, textContent: '', children: [], append(...children) {this.children.push(...children)},
  replaceChildren(...children) {this.children = children}});
const body = node('tbody'), status = node('p');
let event, interval, hide, calls = 0, fail = false;
let artifacts = [{url:'/artifacts/a/demo/',title:'<script>bad</script>',description:'Description',format:'html',updated_at:'now'}];
vm.runInNewContext(readFileSync(process.argv[1], 'utf8'), {
  document:{getElementById:id => id === 'artifacts' ? body : status,createElement:node},
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
assert.equal(body.children[0].children[0].children[0].textContent,'<script>bad</script>');
assert.equal(body.children[0].children[0].children[0].href,'/artifacts/a/demo/');
artifacts=[];
await event.change();
assert.equal(body.children[0].children[0].textContent,'No artifacts registered.');
fail=true;
await interval();
assert.match(status.textContent,/unavailable/);
fail=false;
await interval();
assert.equal(status.textContent,'');
assert.equal(calls,4);
hide();assert.equal(event.closed,true);
"""
        result = subprocess.run(["node", "--input-type=module", "-e", javascript, str(script)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
