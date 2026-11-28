import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration


def test_grouping_deck_refresh_focus_empty_state_and_failed_fetch():
    script = Path(__file__).parents[2] / "src/battuta_artifacts/assets/catalog.js"
    # Stub only browser boundaries; execute the shipped client unchanged.
    javascript = r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const node = (tag, ...classes) => ({tag, classes:new Set(classes), textContent:'', children:[], dataset:{}, attributes:{},
  hidden:false, style:{setProperty(name, value) {this[name] = value}},
  get classList() {const set = this.classes; return {
    contains:name => set.has(name), add:name => set.add(name), remove:name => set.delete(name),
    toggle:(name, force = !set.has(name)) => (force ? set.add(name) : set.delete(name), force)};},
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
  simple(selector) {return selector.startsWith('.') ? this.classes.has(selector.slice(1)) : this.tag === selector},
  matches(selector) {
    return selector.split(',').some(option => {
      const [last, ...ancestors] = option.trim().split(' ').reverse();
      return this.simple(last) && (!ancestors.length || Boolean(this.parentElement?.closest(ancestors.reverse().join(' '))));
    });
  },
  closest(selector) {return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null},
  contains(target) {return target === this || this.children.some(child => child.contains(target))},
  querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)])},
  querySelector(selector) {return this.querySelectorAll(selector)[0]},
  addEventListener(name, fn) {this[name] = fn},
  setAttribute(name, value) {this.attributes[name] = value},
  getAttribute(name) {return this.attributes[name]},
  removeAttribute(name) {if (name === 'datetime') delete this.dateTime; delete this.attributes[name]},
  getBoundingClientRect() {return {left:0, top:0, width:1, height:1}},
  offsetHeight:0,
  focus() {document.activeElement = this}
});
const row = () => {
  const item = node('li', 'artifact'), link = node('a', 'artifact-link');
  item.append(link);
  link.append(node('h3', 'artifact-title'), node('p', 'artifact-description'), node('time'));
  return item;
};
const project = () => {
  const item = node('li', 'project'), tiles = node('ul', 'tiles'), chip = node('li', 'chip');
  const deckTile = node('li', 'deck-tile'), deck = node('button', 'deck'), count = node('span', 'deck-count');
  chip.append(node('h2', 'project-name'), node('span', 'project-count'), node('button', 'chip-toggle'));
  count.append(node('b'));
  deck.append(node('span', 'deck-title'), node('span', 'deck-title'), count);
  deckTile.append(deck); tiles.append(chip, deckTile); item.append(tiles);
  return item;
};
const body = node('ul'), status = node('p'), count = node('span'), empty = node('p');
const template = factory => ({content:{firstElementChild:{cloneNode:factory}}});
const elements = {artifacts:body, status, 'artifact-count':count, 'empty-state':empty,
  'artifact-template':template(row), 'project-template':template(project)};
const document = {activeElement:null, getElementById:id => elements[id]};
let event, interval, hide, calls = 0, fail = false;
const red = {paint:'#D6001C', ink:'#FFFFFF'};
let artifacts = [{slug:'demo',project:'Alpha',url:'/artifacts/a/demo/',title:'<script>bad</script>',description:'Description',updated_at:'2026-10-21T00:30:00+00:00',colour:red}];
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
  setTimeout,
  fetch:async (url, options) => {
    calls++; assert.equal(url,'/artifacts/catalog');assert.equal(options.cache,'no-store');
    return {ok:!fail,json:async()=>({artifacts})};
  }
});
const click = target => body.click({target});
await event.onopen();
const original = body.querySelector('.artifact'), group = body.children[0];
assert.equal(original.querySelector('.artifact-title').textContent,'<script>bad</script>');
assert.equal(original.querySelector('.artifact-link').href,'/artifacts/a/demo/');
assert.equal(original.querySelector('time').textContent,'21 Oct 2026');
assert.equal(count.textContent,'1 work');
assert.equal(group.style['--paint'],'#D6001C','the project takes its colour from the catalog');
assert.equal(group.querySelector('.deck-tile').hidden,true,'one work needs no deck');
assert.equal(group.querySelector('.chip-toggle').hidden,true,'nor a chip toggle');
original.querySelector('.artifact-link').focus();
await interval();
assert.equal(body.querySelector('.artifact'),original,'unchanged refresh keeps the existing row');
assert.equal(body.children[0],group);
artifacts[0].description='Revised description';
await event.change();
assert.equal(document.activeElement,original.querySelector('.artifact-link'));
assert.equal(original.querySelector('.artifact-description').textContent,'Revised description');
fail=true;
await interval();
assert.match(status.textContent,/unavailable/);
assert.equal(body.querySelector('.artifact'),original,'failed fetch preserves visible entries');
fail=false;
// A third work goes into the deck; the chip and deck then open the project.
const other = {...artifacts[0],slug:'other',url:'/artifacts/a/other/',title:'Other',updated_at:'2026-10-20T00:00:00Z'};
const oldest = {...artifacts[0],slug:'oldest',url:'/artifacts/a/oldest/',title:'Oldest',updated_at:'2026-10-19T00:00:00Z'};
artifacts.push(other, oldest);
await event.change();
assert.equal(count.textContent,'3 works');
const deck = group.querySelector('.deck'), toggle = group.querySelector('.chip-toggle');
assert.equal(group.querySelector('.deck-tile').hidden,false);
assert.equal(toggle.hidden,false);
assert.equal(toggle.getAttribute('aria-label'),'All 3 Alpha works');
assert.deepEqual(group.querySelectorAll('.artifact').map(item => item.classList.contains('extra')),[false,false,true]);
assert.equal(group.querySelector('.deck-title').textContent,'Oldest');
assert.equal(group.querySelector('.deck-count b').textContent,'+1');
assert.equal(group.querySelector('.tiles').children.at(-1),group.querySelector('.deck-tile'),'the deck stays last');
click(deck);
assert.equal(group.classList.contains('open'),true);
assert.equal(deck.getAttribute('aria-expanded'),'true');
assert.equal(toggle.getAttribute('aria-expanded'),'true');
await interval();
assert.equal(group.classList.contains('open'),true,'polling retains the open state');
const hiddenLink = group.querySelectorAll('.artifact')[2].querySelector('.artifact-link');
hiddenLink.focus();
click(toggle);
assert.equal(group.classList.contains('open'),false,'the chip stacks the works again');
assert.equal(document.activeElement,toggle,'focus leaves a card that is being stacked');
click(deck);
artifacts=[artifacts[0], other];
await event.change();
assert.equal(group.classList.contains('open'),false,'dropping to two works closes the project');
assert.equal(group.querySelector('.deck-tile').hidden,true);
artifacts=[other];
original.querySelector('.artifact-link').focus();
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
assert.equal(document.activeElement,body.children[0].querySelector('.artifact-link'),'repopulation focuses the first work when there is no toggle');
assert.equal(status.textContent,'');
// Dates, alphabetical projects, deterministic ties and missing-date ordering.
artifacts = [
 {...other,slug:'older',project:'zeta',updated_at:'2025-01-01T00:00:00Z'},
 {...other,slug:'missing-z',updated_at:null},
 {...other,slug:'newest',updated_at:'2026-10-22T00:00:00Z'},
 {...other,slug:'missing-a',updated_at:'bad'},
 {...other,slug:'tie-z',updated_at:'2026-10-21T00:30:00Z'},
 {...other,slug:'tie-a',updated_at:'2026-10-21T01:30:00+01:00'},
 {...other,slug:'unassigned',project:null,updated_at:null,colour:undefined}
];
await event.change();
assert.deepEqual(body.children.map(item => item.querySelector('.project-name').textContent),['Alpha','Unassigned','zeta']);
assert.deepEqual(body.children[0].querySelectorAll('.artifact').map(item => item.dataset.slug),['newest','tie-a','tie-z','missing-a','missing-z']);
assert.equal(body.children[1].style['--paint'],'#000000','work without a colour falls back to black');
const undated = body.children[0].querySelectorAll('.artifact')[3].querySelector('time');
assert.equal(undated.textContent,'Date unavailable');
assert.equal(undated.dateTime,undefined);
// A focused work pushed into a stacked deck hands focus to the deck, never a hidden link.
const moving = body.children[0].querySelectorAll('.artifact')[1];
moving.querySelector('.artifact-link').focus();
artifacts.push({...other,slug:'newer-still',updated_at:'2026-10-23T00:00:00Z'}, {...other,slug:'newest-yet',updated_at:'2026-10-24T00:00:00Z'});
await event.change();
assert.equal(moving.classList.contains('extra'),true);
assert.equal(document.activeElement,body.children[0].querySelector('.deck'));
hide();assert.equal(event.closed,true);
"""
    result = subprocess.run(["node", "--input-type=module", "-e", javascript, str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
