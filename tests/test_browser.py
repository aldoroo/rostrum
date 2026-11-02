"""The engine on its own: its logic under node, its names and types under the TypeScript compiler, and with a real mouse on its demo page"""
from __future__ import annotations

import functools
import http.server
import re
import shutil
import subprocess
import threading
from pathlib import Path

import pytest

ROSTRUM = Path(__file__).resolve().parents[1]
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
BOX = "(sel)=>{const r=document.querySelector(sel).getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round)}"
NOW = 'rostrum-object[name="now"]'
NO_BLUR = "document.querySelectorAll('.rostrum-focus').length"


def test_logic_under_node():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    answer = subprocess.run([node, "--test", "tests/engine.test.mjs"], cwd=ROSTRUM, capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert answer.returncode == 0, answer.stdout[-3000:] + answer.stderr[-800:]


@pytest.mark.heavy
def test_names_and_types_under_the_compiler():
    npx = shutil.which("npx")
    if npx is None:
        pytest.skip("npx is not installed")
    answer = subprocess.run([npx, "-y", "-p", "typescript@5.9", "tsc", "-p", "tsconfig.json"], cwd=ROSTRUM, capture_output=True, text=True, encoding="utf-8", timeout=300)
    if "ENOTFOUND" in answer.stderr or "ECONNREFUSED" in answer.stderr:
        pytest.skip(f"npm registry is not reachable: {answer.stderr[-200:]}")
    assert answer.returncode == 0, answer.stdout[-3000:]


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002
        return


@pytest.fixture
def demo_url():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(ROSTRUM)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/demo/index.html"
    server.shutdown()
    server.server_close()
    thread.join(timeout=10)


def _open_menu(page, selector):
    x, y, w, h = page.evaluate(BOX, selector)
    page.mouse.move(x + w / 2, y + h / 2)
    page.mouse.move(min(x + w, 1426) - 6, max(y + 10, min(64, y + h - 54)) + 20, steps=4)
    page.wait_for_function("document.getElementById('rostrumNotch').classList.contains('rostrum-shown')", timeout=5000)
    assert page.evaluate("document.getElementById('rostrumTray').hidden"), "the drawer opens only on a click"
    # the button slides out to its place, it is pressed there
    page.wait_for_timeout(1000)
    nx, ny, nw, nh = page.evaluate(BOX, "#rostrumNotch")
    page.mouse.move(nx + nw / 2, ny + nh / 2, steps=2)
    page.mouse.click(nx + nw / 2, ny + nh / 2)
    page.wait_for_function("!document.getElementById('rostrumTray').hidden", timeout=5000)
    page.wait_for_timeout(300)


def _act(page, name):
    x, y, w, h = page.evaluate(BOX, f'#rostrumTray [data-act="{name}"]')
    page.mouse.move(x + 20, y + h / 2, steps=2)
    page.mouse.click(x + 20, y + h / 2)


@pytest.mark.heavy
def test_a_site_built_only_of_html_gets_the_whole_rostrum(demo_url):
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as play:
        try:
            browser = play.chromium.launch(channel="msedge", headless=True, args=ARGS)
        except playwright.Error as error:
            pytest.skip(f"Microsoft Edge is not available: {error}")
        page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(demo_url, wait_until="load")
        page.wait_for_selector(f"{NOW}.rostrum-on-table", timeout=30000)
        page.wait_for_timeout(1500)
        table = "document.querySelector('rostrum-table').rostrum"

        # the objects stand side by side as their attributes say
        now = page.evaluate(BOX, NOW)
        numbers = page.evaluate(BOX, 'rostrum-object[name="numbers"]')
        assert now[1] == numbers[1] and now[0] < numbers[0]

        # moved by its menu, it keeps its size, a neighbour stays, and it is remembered
        _open_menu(page, NOW)
        _act(page, "move")
        page.mouse.move(700, 620, steps=8)
        page.mouse.click(700, 620)
        page.wait_for_timeout(400)
        moved = page.evaluate(BOX, NOW)
        assert moved[2:] == now[2:] and moved[:2] != now[:2]
        assert page.evaluate(BOX, 'rostrum-object[name="numbers"]') == numbers
        assert page.evaluate(NO_BLUR) == 0, "nothing of the menu stays after the move"

        # a copy on the workbench with its own place, the original stays in its tab
        _open_menu(page, 'rostrum-object[name="numbers"]')
        _act(page, "bench")
        page.wait_for_function(f"{table}.workbench.list.length===1", timeout=5000)
        page.mouse.move(700, 450)
        page.wait_for_timeout(300)
        assert page.evaluate("document.querySelector('#t-work rostrum-object[name=numbers]')!==null")
        page.click('.rostrum-rail button[data-tab="about"]', no_wait_after=True)
        page.wait_for_function(f"{table}.tab==='about'&&!{table}.flight", timeout=20000)
        assert page.evaluate("document.querySelector('.rostrum-title').textContent") == "About"
        page.click('.rostrum-rail button[data-tab="bench"]', no_wait_after=True)
        page.wait_for_function(f"{table}.tab==='bench'&&!{table}.flight", timeout=20000)
        page.wait_for_timeout(500)
        assert page.evaluate("document.querySelector('#t-bench rostrum-object[name=numbers]')!==null")
        page.click('.rostrum-rail button[data-tab="work"]', no_wait_after=True)
        page.wait_for_function(f"{table}.tab==='work'&&!{table}.flight", timeout=20000)
        page.wait_for_timeout(500)
        assert page.evaluate("document.querySelector('#t-work rostrum-object[name=numbers]')!==null")

        page.reload(wait_until="load")
        page.wait_for_selector(f"{NOW}.rostrum-on-table", timeout=30000)
        page.wait_for_timeout(1500)
        assert page.evaluate(BOX, NOW)[:2] == moved[:2]
        assert page.evaluate(f"{table}.workbench.list.length") == 1

        # the settings live in the corner, the standard arrangement is always there
        page.mouse.move(1439, 899, steps=4)
        page.mouse.click(1439, 899)
        page.wait_for_timeout(400)
        page.click('#rostrumSettings [data-set="standard"]', no_wait_after=True)
        page.wait_for_timeout(600)
        assert page.evaluate(BOX, NOW)[:2] == now[:2]

        assert errors == []
        browser.close()


@pytest.fixture
def chromium():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as play:
        try:
            browser = play.chromium.launch(channel="msedge", headless=True, args=ARGS)
        except playwright.Error as error:
            pytest.skip(f"Microsoft Edge is not available: {error}")
        yield browser
        browser.close()


def _api_page(browser, demo_url, init=None):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    if init:
        context.add_init_script(init)
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda exc: page.errors.append(str(exc)))
    page.goto(demo_url.replace("demo/index.html", "tests/api.html"), wait_until="load")
    page.wait_for_function("window.rostrum&&document.querySelector('#first.rostrum-on-table')", timeout=30000)
    page.wait_for_timeout(800)
    return page


@pytest.mark.heavy
def test_the_example_of_the_readme_starts_and_its_rail_works(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    assert page.evaluate(BOX, "#first")[2] > 0
    page.click('nav button[data-tab="details"]', no_wait_after=True)
    page.wait_for_function("rostrum.tab==='details'&&!rostrum.flight", timeout=20000)
    page.wait_for_timeout(300)
    assert page.evaluate(BOX, "#third")[2] > 0
    assert page.errors == []


@pytest.mark.heavy
def test_a_figure_changed_twice_during_its_run_ends_on_the_true_value(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    final = page.evaluate("""async()=>{
      const v=document.getElementById('total'),cell=v.parentElement;
      for(const value of ['7654321','7654322','7654323']){
        v.textContent=value;
        rostrum.fx.reading(cell,0,false,0);
        await new Promise(r=>setTimeout(r,60));
        rostrum.fx.reading(cell,0,false,0);
        await new Promise(r=>setTimeout(r,40));
      }
      await new Promise(r=>setTimeout(r,1200));
      return v.textContent;}""")
    assert final == "7654323"
    assert page.errors == []


@pytest.mark.heavy
def test_two_readings_with_one_label_in_two_objects_are_two_readings(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    keys = page.evaluate("""()=>[rostrum.fx.scope(document.getElementById('total')),rostrum.fx.scope(document.getElementById('total2'))]""")
    assert keys[0] != keys[1]


@pytest.mark.heavy
def test_a_tab_can_be_left_with_an_object_held_to_the_lens(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate("()=>{rostrum.flightOn=false;const o=rostrum.objectOf(document.getElementById('first'));o.togglePin();rostrum.collect();rostrum.open('details');}")
    page.wait_for_timeout(300)
    page.evaluate("rostrum.camera.moveTo(rostrum.camera.x+50,rostrum.camera.y+50)")
    page.wait_for_timeout(500)
    assert page.errors == []
    page.evaluate("rostrum.open('overview')")
    page.wait_for_timeout(300)
    assert page.evaluate("document.getElementById('first').classList.contains('rostrum-pinned')")
    assert page.errors == []


@pytest.mark.heavy
def test_a_button_of_the_mouse_lost_outside_the_page_does_not_keep_the_camera(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.mouse.move(1200, 700)
    page.mouse.down()
    page.mouse.move(1100, 600, steps=3)
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    page.mouse.up()
    at = page.evaluate("[rostrum.camera.goalX,rostrum.camera.goalY]")
    page.mouse.move(800, 300, steps=3)
    page.wait_for_timeout(200)
    assert page.evaluate("[rostrum.camera.goalX,rostrum.camera.goalY]") == at


@pytest.mark.heavy
def test_broken_storage_does_not_stop_the_start(chromium, demo_url):
    page = _api_page(chromium, demo_url, init="localStorage.setItem('api-test.rostrumSpots.overview','{not json')")
    assert page.evaluate(BOX, "#first")[2] > 0
    assert page.errors == []


@pytest.mark.heavy
def test_an_object_named_constructor_has_no_place_yet(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    assert page.evaluate("(()=>{const e=document.getElementById('first');e.id='constructor';const o=rostrum.objectOf(e);return o.spot===undefined&&o.pin===undefined})()")


@pytest.mark.heavy
def test_destroy_leaves_nothing_behind(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    native = page.evaluate("()=>{const t=document.createElement('div');return t.scrollIntoView.toString().includes('native code')}")
    assert native is False
    page.evaluate("rostrum.destroy()")
    state = page.evaluate("""()=>[document.createElement('div').scrollIntoView.toString().includes('native code'),
      ['rostrumCanvas','rostrumTray','rostrumNotch','rostrumCorner','rostrumSettings','rostrumViewfinder','rostrumLens','rostrumTabMap'].filter(id=>document.getElementById(id)),
      'rostrum' in document.documentElement.dataset]""")
    assert state == [True, [], False]
    at = page.evaluate("rostrum.camera.y")
    page.mouse.move(700, 400)
    page.mouse.wheel(0, 300)
    page.wait_for_timeout(300)
    assert page.evaluate("rostrum.camera.y") == at
    assert page.errors == []


@pytest.mark.heavy
def test_a_title_cannot_inject_markup_and_a_bad_start_opens_the_first_tab(chromium, demo_url):
    page = chromium.new_context().new_page()
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(demo_url, wait_until="load")
    page.wait_for_selector('rostrum-object[name="now"].rostrum-on-table', timeout=30000)
    page.evaluate("""()=>{document.querySelector('rostrum-table').remove();
      document.body.insertAdjacentHTML('beforeend','<rostrum-table storage="x." start="nope"><rostrum-tab name="a" title="&lt;img id=injected src=x&gt;"><rostrum-object name="o">x</rostrum-object></rostrum-tab></rostrum-table>');}""")
    page.wait_for_selector('rostrum-object[name="o"].rostrum-on-table', timeout=10000)
    assert page.evaluate("document.getElementById('injected')") is None
    assert errors == []


def _demo(browser, demo_url):
    page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
    page.errors = []
    page.on("pageerror", lambda exc: page.errors.append(str(exc)))
    page.goto(demo_url, wait_until="load")
    page.wait_for_selector(f"{NOW}.rostrum-on-table", timeout=30000)
    page.wait_for_timeout(1500)
    return page


@pytest.mark.heavy
def test_a_menu_pulls_focus_and_gives_it_back(chromium, demo_url):
    page = _demo(chromium, demo_url)
    _open_menu(page, NOW)
    assert page.evaluate(NO_BLUR) > 0
    # nothing is drawn behind the words of a row
    plain = page.evaluate("""()=>{const s=getComputedStyle(document.querySelector('#rostrumTray [data-act="move"]'));return [s.backgroundColor,s.backgroundImage,s.boxShadow,s.textDecorationLine]}""")
    assert plain == ["rgba(0, 0, 0, 0)", "none", "none", "none"]
    page.keyboard.press("Escape")
    page.mouse.move(300, 860)
    page.wait_for_timeout(1500)
    assert page.evaluate(NO_BLUR) == 0
    assert page.errors == []


@pytest.mark.heavy
def test_the_blur_and_the_words_of_a_menu_come_up_on_one_clock(chromium, demo_url):
    page = _demo(chromium, demo_url)
    clock = page.evaluate(
        f"""()=>new Promise(done=>{{const d=document.querySelector('rostrum-table').rostrum;d.tray.show(d.objectOf(document.querySelector('{NOW}')));
          const look=()=>{{const task=[...d.writing.tasks][0],layer=document.querySelector('.rostrum-focus');
            if(!task||!layer||!layer.getAnimations().length){{requestAnimationFrame(look);return;}}
            const a=layer.getAnimations()[0];done([a.effect.getTiming().duration,task.span,performance.now()-task.start,Number(a.currentTime)]);}};look();}})"""
    )
    assert clock[0] == clock[1], "the blur takes as long as the words"
    assert abs(clock[2] - clock[3]) < 40, "and starts with them"
    assert page.errors == []


@pytest.mark.heavy
def test_the_light_on_a_figure_is_counted_from_the_page_and_does_not_care_where_the_camera_is(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    place = """(()=>{rostrum.options.accents='#total';rostrum.collect();const r=rostrum.scene.emittersOf('overview').find(p=>p.kind==='accent');return [r.x,r.y,r.w,r.h]})()"""
    screen = """(()=>{const r=document.getElementById('total').getBoundingClientRect(),k=rostrum.camera.scale;return [rostrum.camera.x+(r.left-innerWidth/2)*k,rostrum.camera.y+(r.top-innerHeight/2)*k,r.width*k,r.height*k]})()"""
    counted, seen = page.evaluate(place), page.evaluate(screen)
    assert all(abs(a - b) < 1.5 for a, b in zip(counted, seen)), (counted, seen)
    page.evaluate("rostrum.camera.tilt=0.15;rostrum.camera.h=5000;rostrum.camera.x+=400;rostrum.camera.apply();")
    assert page.evaluate(place) == counted
    assert page.errors == []


@pytest.mark.heavy
def test_an_object_is_drawn_forms_first_then_words_from_the_largest_type(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    plan = page.evaluate(
        """()=>{const el=document.getElementById('second');
          el.insertAdjacentHTML('beforeend','<div style="border:1px solid red;height:300px"><div style="height:30px;background:rgb(1,2,3)"></div><p style="font-size:30px">Large</p><p style="font-size:12px">small</p></div>');
          rostrum.writing.tasks.clear();
          const before=performance.now();rostrum.fx.draft(el,0);
          const forms=[...el.querySelectorAll('div')].flatMap(e=>e.getAnimations().map(a=>[e.offsetWidth*e.offsetHeight,a.effect.getTiming().delay]));
          const words=[...rostrum.writing.tasks].map(t=>[Math.round(parseFloat(getComputedStyle(t.nodes[0].node.parentElement).fontSize)),t.start-before]);
          const hidden=CSS.highlights.get('rostrum-hidden').size;
          return {forms,words,hidden};}"""
    )
    forms = sorted(plan["forms"], key=lambda f: -f[0])
    assert [f[1] for f in forms] == sorted(f[1] for f in forms), "the larger the form, the earlier"
    words = sorted(plan["words"], key=lambda w: w[1])
    assert [w[0] for w in words] == sorted((w[0] for w in words), reverse=True), "the larger the type, the earlier"
    assert words[0][1] > forms[-1][1] * 0.8, "words come after the forms"
    assert plan["hidden"] > 0
    assert page.errors == []


@pytest.mark.heavy
def test_a_repaint_of_a_known_place_does_not_draw_again_and_a_grown_object_slides(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate("document.getElementById('first').insertAdjacentHTML('beforeend','<div id=\"slot\"><p>one</p></div>')")
    page.wait_for_timeout(600)
    page.wait_for_function("rostrum.writing.tasks.size===0", timeout=10000)
    page.evaluate("document.getElementById('slot').innerHTML='<p>one</p>'")
    page.wait_for_timeout(100)
    assert page.evaluate("rostrum.writing.tasks.size") == 0
    slid = page.evaluate(
        """async()=>{const a=document.getElementById('first'),o=rostrum.objectOf(a);o.placedAt={...o.placedAt,y:o.placedAt.y-40};
          rostrum.collect();return [!!o.slide,o.slide&&o.slide.dy,a.getAnimations().some(x=>String(x.effect.getKeyframes()[0].transform).includes('translateY'))]}"""
    )
    assert slid == [True, -40, True]
    assert page.errors == []


@pytest.mark.heavy
def test_an_object_of_a_held_tab_is_not_seen_until_the_data_lie_in_it(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    held = page.evaluate(
        """async()=>{let done;const loaded=new Promise(r=>{done=r;});window.__done=done;
          rostrum.holdDrawing(rostrum.tab,loaded);
          rostrum.section.insertAdjacentHTML('beforeend','<div id="late" class="card" style="height:120px"><p>late words</p></div>');
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const late=document.getElementById('late');
          return {table:late.matches('.rostrum-on-table'),lit:late.matches('.rostrum-lit'),seen:getComputedStyle(late).visibility,outline:rostrum.fx.struck(late)};}"""
    )
    # its size is not known yet, an outline up now would jump when the data come
    assert held == {"table": True, "lit": False, "seen": "hidden", "outline": False}
    page.evaluate("window.__done()")
    page.wait_for_function("document.getElementById('late').matches('.rostrum-lit')", timeout=5000)
    assert page.evaluate("[getComputedStyle(document.getElementById('late')).visibility,document.querySelectorAll('.rostrum-held').length]") == ["visible", 0]
    assert page.errors == []


@pytest.mark.heavy
def test_data_that_take_too_long_do_not_keep_the_table_empty(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate(
        """()=>{rostrum.holdDrawing(rostrum.tab,new Promise(()=>{}));
          rostrum.section.insertAdjacentHTML('beforeend','<div id="late" class="card" style="height:120px"><p>late</p></div>');}"""
    )
    page.wait_for_function("document.getElementById('late').matches('.rostrum-lit')", timeout=12000)
    assert page.evaluate("document.querySelectorAll('.rostrum-held,.rostrum-loaded').length") == 0
    assert page.errors == []


@pytest.mark.heavy
def test_a_press_that_opens_another_tab_stays_on_that_tab(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate(
        """()=>{const b=document.createElement('button');b.id='go';b.textContent='go';b.onclick=()=>rostrum.open('details');document.getElementById('first').prepend(b);}"""
    )
    page.wait_for_timeout(300)
    box = page.evaluate(BOX, "#go")
    page.mouse.click(box[0] + box[2] / 2, box[1] + box[3] / 2)
    page.wait_for_function("!rostrum.flight&&rostrum.isCalm", timeout=8000)
    assert page.evaluate("[rostrum.tab,document.querySelector('[data-rostrum-plane]>.rostrum-open').id]")[0] == "details"
    assert page.errors == []


@pytest.mark.heavy
def test_two_tabs_let_go_at_once_are_both_drawn(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate("()=>{for(const tab of ['overview','details'])rostrum.holdDrawing(tab,Promise.resolve());}")
    page.wait_for_function("document.querySelectorAll('.rostrum-held').length===0", timeout=5000)
    assert page.errors == []


@pytest.mark.heavy
def test_an_object_that_grew_pushes_the_others_away_before_the_frame_is_painted(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    over = page.evaluate(
        """async()=>{document.getElementById('first').insertAdjacentHTML('beforeend','<div style="height:700px"><p>tall</p></div>');
          await Promise.resolve();
          return new Promise(resolve=>requestAnimationFrame(()=>{const r=rostrum.options.surfaces(rostrum.section).map(e=>{const w=rostrum.objectOf(e).world;return {left:w.x,top:w.y,right:w.x+w.w,bottom:w.y+w.h};});let n=0;
            for(let a=0;a<r.length;a++)for(let b=a+1;b<r.length;b++)if(r[a].left<r[b].right-1&&r[b].left<r[a].right-1&&r[a].top+1<r[b].bottom&&r[b].top+1<r[a].bottom)n++;
            resolve(n);}));}"""
    )
    assert over == 0
    assert page.errors == []


@pytest.mark.heavy
def test_a_tip_stands_beside_what_it_speaks_about_and_does_not_widen_its_object(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate(
        """()=>{const o=document.getElementById('second');o.style.minHeight='300px';
          o.insertAdjacentHTML('beforeend','<div id="siteTip" class="rostrum-tip" data-rostrum-about="0.2 0 0.1 1" style="display:none;position:absolute;left:0;top:0">what it says</div>');
          rostrum.collect();window.__width=o.offsetWidth;const r=o.getBoundingClientRect();
          document.getElementById('siteTip').style.display='block';}"""
    )
    page.wait_for_function("document.getElementById('rostrumPointTip').style.display==='block'", timeout=5000)
    page.wait_for_timeout(300)
    shown = page.evaluate(
        """()=>{const o=document.getElementById('second'),t=document.getElementById('rostrumPointTip'),b=t.getBoundingClientRect();
          const a=rostrum.popups.tipAbout();
          rostrum.collect();
          return {text:t.textContent,overAbout:!(b.left>=a.right||b.right<=a.left||b.top>=a.bottom||b.bottom<=a.top),near:Math.min(Math.abs(b.left-a.right),Math.abs(a.left-b.right))<20,
            source:getComputedStyle(document.getElementById('siteTip')).visibility,grown:o.offsetWidth!==window.__width,wide:rostrum.objectOf(o).widenedAt,blur:document.querySelectorAll('.rostrum-focus').length>0};}"""
    )
    assert shown == {"text": "what it says", "overAbout": False, "near": True, "source": "hidden", "grown": False, "wide": 0, "blur": True}
    page.evaluate("document.getElementById('siteTip').style.display='none'")
    page.wait_for_function("document.getElementById('rostrumPointTip').style.display==='none'", timeout=5000)
    page.wait_for_function(NO_BLUR + "===0", timeout=5000)
    page.evaluate("document.getElementById('siteTip').style.display='block'")
    page.wait_for_function("document.getElementById('rostrumPointTip').style.display==='block'", timeout=5000)
    page.evaluate("document.getElementById('siteTip').remove()")
    page.wait_for_function("document.getElementById('rostrumPointTip').style.display==='none'", timeout=5000)
    page.wait_for_function(NO_BLUR + "===0", timeout=5000)
    assert page.errors == []


@pytest.mark.heavy
def test_the_icons_and_the_blur_of_a_tip_come_up_along_with_its_lines(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    frames = page.evaluate(
        """async()=>{const o=document.getElementById('second');
          const row='<div><span style="display:inline-block;width:10px;height:10px;background:red"></span> a row of words</div>';
          o.insertAdjacentHTML('beforeend','<div id="siteTip" class="rostrum-tip" style="display:none;position:absolute">'+row.repeat(8)+'</div>');
          await new Promise(r=>setTimeout(r,200));
          document.getElementById('siteTip').style.display='block';
          const seen=[];const t0=performance.now();
          while(performance.now()-t0<900){await new Promise(r=>requestAnimationFrame(r));
            const tip=document.getElementById('rostrumPointTip'),layer=[...document.querySelectorAll('.rostrum-focus')].pop();
            if(tip.style.display==='block'&&tip.querySelectorAll('span').length)seen.push([tip.querySelectorAll('.rostrum-unwritten-mark').length,layer?parseFloat(layer.style.height)||0:0]);}
          return seen;}"""
    )
    assert frames[0][0] >= 7, "the first painted frame shows no icon yet"
    marks = [f[0] for f in frames]
    assert marks == sorted(marks, reverse=True) and marks[-1] == 0, "icons come one by one"
    heights = [f[1] for f in frames if f[1]]
    assert heights == sorted(heights) and heights[-1] > heights[0] * 1.3, "the field grows with the lines"
    assert page.errors == []


@pytest.mark.heavy
def test_an_object_says_that_its_data_are_on_their_way_and_a_quick_answer_says_nothing(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.wait_for_function("document.getElementById('first').matches('.rostrum-lit')", timeout=5000)
    page.evaluate("()=>{rostrum.updating(rostrum.tab,new Promise(r=>{window.__land=r;}));}")
    assert page.evaluate("document.querySelectorAll('.rostrum-updating').length") == 0, "not at once, a quick answer needs no telling"
    page.wait_for_function("document.querySelectorAll('.rostrum-updating').length>0", timeout=3000)
    waiting = page.evaluate("rostrum.updates.scans(performance.now())")
    assert waiting and all(0 <= scan["head"] < 1 for scan in waiting)
    page.evaluate("window.__land()")
    page.wait_for_function("document.querySelectorAll('.rostrum-updating').length===0", timeout=3000)
    assert all(scan["head"] < 0 for scan in page.evaluate("rostrum.updates.scans(performance.now())")), "the data landed, a pass goes down"
    page.evaluate("()=>{rostrum.updating(rostrum.tab,Promise.reject(new Error('it failed')));}")
    page.wait_for_timeout(300)
    assert page.evaluate("document.querySelectorAll('.rostrum-updating').length") == 0
    assert page.errors == []


@pytest.mark.heavy
def test_a_chart_with_new_data_goes_from_what_it_showed(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    moved = page.evaluate(
        """async()=>{const o=document.getElementById('first');
          o.insertAdjacentHTML('beforeend','<div id="plot"><svg viewBox="0 0 200 100" width="200" height="100"><rect x="10" y="50" width="20" height="50" fill="red"/><rect x="40" y="20" width="20" height="80" fill="red"/></svg></div>');
          await new Promise(r=>setTimeout(r,1400));
          document.getElementById('plot').innerHTML='<svg viewBox="0 0 200 100" width="200" height="100"><rect x="10" y="10" width="20" height="90" fill="red"/><rect x="40" y="60" width="20" height="40" fill="red"/></svg>';
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const first=document.querySelector('#plot rect'),a=first.getAnimations()[0];
          return a?a.effect.getKeyframes()[0].y:null;}"""
    )
    assert moved == "50px"
    assert page.errors == []


@pytest.mark.heavy
def test_each_map_goes_away_in_the_settings_and_a_map_is_not_there_until_the_pointer_comes(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    assert page.evaluate("getComputedStyle(document.querySelector('.rostrum-table-map')).opacity") == "0"
    page.evaluate("document.getElementById('rostrumCorner').click()")
    page.wait_for_selector("#rostrumSettings [data-set=tableMap]", state="attached")
    page.evaluate("document.querySelector('#rostrumSettings [data-set=tableMap]').click()")
    assert page.evaluate("getComputedStyle(document.querySelector('.rostrum-table-map')).display") == "none"
    assert page.evaluate("getComputedStyle(document.getElementById('rostrumTabMap')).display") != "none"
    page.evaluate("document.querySelector('#rostrumSettings [data-set=tabMap]').click()")
    assert page.evaluate("getComputedStyle(document.getElementById('rostrumTabMap')).display") == "none"
    page.reload(wait_until="load")
    page.wait_for_function("window.rostrum", timeout=10000)
    assert page.evaluate("[document.documentElement.hasAttribute('data-rostrum-no-table-map'),document.documentElement.hasAttribute('data-rostrum-no-tab-map')]") == [True, True], "they stay off"
    page.evaluate("()=>{rostrum.maps.tableShown=true;rostrum.maps.tabShown=true;}")
    assert page.errors == []


def _period_picker(page):
    page.evaluate(
        """async()=>{const {PeriodPicker}=await import(new URL('../calendar.js',location.href).href);
          const host=document.createElement('div');document.getElementById('first').prepend(host);window.__picks=[];
          const day=(m,d)=>Date.UTC(2026,m,d)/1000;
          window.__options={load:async()=>({buckets:[{t:day(8,10),values:{n:5,f:1}},{t:day(8,11),values:{n:7}}]}),bar:'n',marks:[{name:'f',color:'red'}],
            loadHours:async d=>({buckets:[{t:d+14*3600,values:{n:3,f:1}},{t:d+15*3600,values:{n:4}}]}),failed:e=>{throw e;},
            pick:p=>window.__picks.push(p),rangeText:(a,b)=>`${a}-${b}`,summary:t=>`n=${t.n||0}`,lengthText:(a,b)=>`${(b-a)/86400}d`,now:()=>day(9,31),placeholder:'type',
            words:{from:'from',to:'to',calendar:'calendar',parts:{day:'day',month:'month',year:'year',hour:'hour',minute:'minute'},today:'today',yesterday:'yesterday',months:['january','february','march','april','may','june','july','august','september','october','november','december'],monthsShort:['1','2','3','4','5','6','7','8','9','10','11','12'],weekdays:['m','t','w','t','f','s','s'],units:{minute:['m'],hour:['h'],day:['d'],week:['w'],month:['mo'],year:['y']}},
            notUnderstood:'bad',endBeforeStart:'end first',presets:[{label:'A',run:()=>{window.__picks.push('preset');}}]};
          window.__PeriodPicker=PeriodPicker;
          window.__picker=new PeriodPicker(host,window.__options);
          window.__picker.show(day(8,10),day(8,12));await window.__picker.refresh();}"""
    )


_PERIOD_DIGITS = "[...document.querySelectorAll('.rostrum-period-stamp input')].map(e=>e.value).join(' ')"


@pytest.mark.heavy
def test_a_facet_is_a_word_a_press_shows_these_rows_and_a_small_word_the_opposite(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate(
        """async()=>{const {Facet}=await import(new URL('../facet.js',location.href).href);
          const host=document.createElement('div');host.style.marginLeft='120px';document.getElementById('first').prepend(host);window.__changes=[];
          window.__facet=new Facet(host,{label:'reds',mark:'red',not:'except',format:n=>`#${n}`,
            change:state=>{window.__changes.push(state);window.__facet.setState(state);}});
          window.__facet.show({with:17,without:575});}"""
    )
    box = lambda selector: page.evaluate(BOX, selector)
    press = lambda selector: page.mouse.click(box(selector)[0] + box(selector)[2] / 2, box(selector)[1] + box(selector)[3] / 2)
    number = lambda: page.evaluate("document.querySelector('.rostrum-facet-main b').textContent")
    state = lambda: page.evaluate("document.querySelector('.rostrum-facet').dataset.state")
    seen = "getComputedStyle(document.querySelector('.rostrum-facet-not')).visibility"
    assert number() == "#17"
    assert page.evaluate(seen) == "hidden", "the opposite is there only for a filter that is on"
    size = box(".rostrum-facet")[2:]
    press(".rostrum-facet-name")
    assert state() == "include" and page.evaluate(seen) == "visible"
    assert box(".rostrum-facet")[2:] == size, "the small word takes no place from its neighbours"
    press(".rostrum-facet-not")
    assert state() == "exclude" and number() == "#575"
    press(".rostrum-facet-not")
    assert state() == "include" and number() == "#17"
    press(".rostrum-facet-name")
    assert state() == "off"
    assert page.evaluate("window.__changes") == ["include", "exclude", "include", "off"]
    page.evaluate("window.__facet.show(null)")
    assert number() == ""
    assert page.errors == []


def _selection_line(page):
    page.evaluate(
        """async()=>{const {SelectionLine,readQuery}=await import(new URL('../selection.js',location.href).href);
          const host=document.createElement('div');host.style.margin='0 0 0 120px';document.getElementById('first').prepend(host);
          const vocabulary={filters:[{id:'a',word:'red',without:'no red',names:['red']},{id:'f',word:'blue',without:'no blue',names:['blue']}],negatives:['no'],fillers:[],tags:[]};
          window.__on=[];window.__kept=[{name:'one',text:'blue'}];window.__took=[];
          const draw=()=>window.__line.sync();
          window.__line=new SelectionLine(host,{placeholder:'type',labels:{presets:'kept',save:'+ save',name:'name',remove:'remove'},
            words:()=>window.__on.map(text=>({text,drop:()=>{window.__on=window.__on.filter(x=>x!==text);draw();}})),
            items:()=>window.__kept.map(item=>({...item,count:'3'})),active:()=>window.__on.join()==='blue'?'one':null,
            savable:()=>window.__on.length&&window.__on.join()!=='blue'?window.__on.join(' '):null,
            say:text=>readQuery(text,vocabulary).unknown?null:'seen',
            add:text=>{if(readQuery(text,vocabulary).unknown)return false;window.__on.push(text);draw();return true;},
            take:text=>{window.__took.push(text);window.__on=[text];draw();return true;},
            save:(name,text)=>window.__kept.push({name,text}),remove:name=>{window.__kept=window.__kept.filter(x=>x.name!==name);}});}"""
    )


@pytest.mark.heavy
def test_one_line_holds_what_is_on_and_takes_more_with_the_saved_ones_under_it(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _selection_line(page)
    box = lambda selector: page.evaluate(BOX, selector)
    press = lambda selector: page.mouse.click(box(selector)[0] + box(selector)[2] / 2, box(selector)[1] + box(selector)[3] / 2)
    words = lambda: page.evaluate("[...document.querySelectorAll('.rostrum-selection-words button')].map(b=>b.textContent)")
    shown = lambda: not page.evaluate("document.querySelector('.rostrum-selection-panel').hidden")
    press(".rostrum-selection-query")
    assert shown(), "the saved ones open with the line"
    page.keyboard.type("red")
    assert page.evaluate("document.querySelector('.rostrum-selection-said').textContent") == "seen"
    page.keyboard.press("Enter")
    assert words() == ["red"] and page.evaluate("document.querySelector('.rostrum-selection-query').value") == ""
    # what it does not know stays in the field and nothing changes
    page.keyboard.type("nope")
    page.keyboard.press("Enter")
    assert words() == ["red"]
    assert page.evaluate("document.querySelector('.rostrum-selection-query').classList.contains('rostrum-selection-bad')")
    page.keyboard.press("Control+a")
    page.keyboard.type("blue")
    page.keyboard.press("Enter")
    assert words() == ["red", "blue"]
    # a press on a word and a backspace in the empty field take a word off
    page.mouse.click(box(".rostrum-selection-words button")[0] + 5, box(".rostrum-selection-words button")[1] + 5)
    assert words() == ["blue"]
    assert page.evaluate("document.querySelector('.rostrum-selection-open').textContent") == "one", "the name of what is on"
    press(".rostrum-selection-query")
    page.keyboard.press("Backspace")
    assert words() == []
    assert page.evaluate("document.querySelector('.rostrum-selection-open').textContent") == "kept"
    # a saved one takes the place of what is on and closes the list
    press(".rostrum-selection-query")
    press(".rostrum-selection-take")
    assert page.evaluate("window.__took") == ["blue"] and not shown() and words() == ["blue"]
    # what is not saved yet can be saved, what is can be removed
    page.evaluate("()=>{window.__on=['red'];window.__line.sync();}")
    press(".rostrum-selection-open")
    press(".rostrum-selection-save")
    page.keyboard.type("two")
    page.keyboard.press("Enter")
    assert page.evaluate("window.__kept.map(x=>x.name)") == ["one", "two"]
    assert page.evaluate("[...document.querySelectorAll('.rostrum-selection-take')].map(b=>b.textContent)") == ["one", "two"]
    page.evaluate("document.querySelector('.rostrum-selection-item[data-name=\"one\"] .rostrum-selection-drop').click()")
    assert page.evaluate("[...document.querySelectorAll('.rostrum-selection-take')].map(b=>b.textContent)") == ["two"]
    page.keyboard.press("Escape")
    assert not shown()
    assert page.errors == []


@pytest.mark.heavy
def test_a_menu_open_inside_an_object_gives_it_no_scrollbars_and_no_growth(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _selection_line(page)
    box = lambda selector: page.evaluate(BOX, selector)
    # an object the hand gave a size scrolls its own content
    page.evaluate("()=>{const st=document.createElement('style');st.textContent='#first{height:120px!important;overflow-y:auto}';document.head.append(st);}")
    before = page.evaluate("(()=>{const r=document.getElementById('first').getBoundingClientRect();return [r.width,r.height]})()")
    x, y, w, h = box(".rostrum-selection-query")
    page.mouse.click(x + w / 2, y + h / 2)
    page.keyboard.type("red")
    state = "(()=>{const c=document.getElementById('first'),s=getComputedStyle(c),r=c.getBoundingClientRect();return {over:[s.overflowX,s.overflowY],size:[r.width,r.height],bars:c.offsetWidth-c.clientWidth+c.offsetHeight-c.clientHeight}})()"
    opened = page.evaluate(state)
    assert opened["over"] == ["visible", "visible"], opened
    assert opened["size"] == before, "it does not grow"
    # the list is not cut by the object
    panel = box(".rostrum-selection-panel")
    under = page.evaluate("([x,y])=>{const e=document.elementFromPoint(x,y);return !!e.closest('.rostrum-selection-panel')}", [panel[0] + panel[2] / 2, panel[1] + panel[3] - 4])
    assert under
    # over the other objects too, whatever they hold
    assert page.evaluate("getComputedStyle(document.getElementById('first')).zIndex") == "100002"
    # leaving the menu gives no scrollbars for the time its blur fades
    page.wait_for_function("!!document.querySelector('#first .rostrum-focus-inside')", timeout=5000)
    page.evaluate("""()=>{window.__seen=[];window.__faded=false;const c=document.getElementById('first');
      const look=()=>{if(!c.querySelector('.rostrum-focus-inside')){window.__faded=true;return;}
        const s=getComputedStyle(c);window.__seen.push([s.overflowX,s.overflowY,c.offsetWidth-c.clientWidth,c.offsetHeight-c.clientHeight]);requestAnimationFrame(look);};look();}""")
    page.keyboard.press("Escape")
    page.wait_for_function("window.__faded", timeout=5000)
    seen = page.evaluate("window.__seen")
    assert seen and all(row == ["visible", "visible", 0, 0] for row in seen), seen
    assert page.evaluate(state)["over"] != ["visible", "visible"], "its own scrolling comes back"
    assert page.errors == []


@pytest.mark.heavy
def test_a_menu_closed_before_its_first_frame_leaves_no_blur_and_scrolls_again(chromium, demo_url):
    late_frames = "const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(()=>setTimeout(()=>raf(cb),90));"
    page = _api_page(chromium, demo_url, init=late_frames)
    _selection_line(page)
    page.evaluate("()=>{const st=document.createElement('style');st.textContent='#first{height:120px!important;overflow-y:auto}';document.head.append(st);}")
    x, y, w, h = page.evaluate(BOX, ".rostrum-selection-query")
    page.mouse.click(x + w / 2, y + h / 2)
    page.keyboard.type("red")
    page.keyboard.press("Escape")
    page.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))")
    page.wait_for_function("!document.querySelector('#first .rostrum-focus-inside')", timeout=5000)
    assert page.evaluate("rostrum.focus.fields.size") == 0
    assert page.evaluate("getComputedStyle(document.getElementById('first')).overflowY") == "auto"
    assert page.errors == []


@pytest.mark.heavy
def test_a_lookup_cleans_takes_a_whole_value_and_offers_what_is_known(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate(
        """async()=>{const {Lookup}=await import(new URL('../lookup.js',location.href).href);
          const host=document.createElement('div');host.style.margin='0 0 0 120px';const input=document.createElement('input');input.id='who';host.append(input);document.getElementById('first').prepend(host);
          window.__taken=[];window.__acted=[];
          window.__lookup=new Lookup(input,{length:4,clean:text=>text.replace(/\\D/g,''),labels:{clear:'clear'},
            suggest:text=>['1111','1222','3333'].filter(v=>v.includes(text)).map(value=>({value,note:'n'+value})),
            choose:value=>window.__taken.push(value),facts:value=>`facts ${value}`,action:{label:'open',run:value=>window.__acted.push(value)}});}"""
    )
    box = lambda selector: page.evaluate(BOX, selector)
    press = lambda selector: page.mouse.click(box(selector)[0] + box(selector)[2] / 2, box(selector)[1] + box(selector)[3] / 2)
    value = lambda: page.evaluate("document.querySelector('#who').value")
    offered = lambda: page.evaluate("[...document.querySelectorAll('.rostrum-lookup-panel button span')].map(b=>b.textContent)")
    press("#who")
    assert offered() == ["1111", "1222", "3333"]
    page.keyboard.type("1x")
    assert value() == "1", "only digits stay"
    assert offered() == ["1111", "1222"]
    assert page.evaluate("window.__taken") == [], "a part of a value is not taken"
    assert page.evaluate("document.querySelector('.rostrum-lookup-action').hidden")
    # the arrows go over what is offered, enter takes it
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    assert page.evaluate("window.__taken") == ["1222"] and value() == "1222"
    assert page.evaluate("document.querySelector('.rostrum-lookup-panel').hidden")
    assert page.evaluate("document.querySelector('.rostrum-lookup-facts').textContent") == "facts 1222"
    press(".rostrum-lookup-action")
    assert page.evaluate("window.__acted") == ["1222"]
    # a whole value pasted with its dirt is taken by itself
    press("#who")
    page.keyboard.insert_text("33 3-3")
    assert page.evaluate("window.__taken.at(-1)") == "3333" and value() == "3333"
    press(".rostrum-lookup-clear")
    assert page.evaluate("window.__taken.at(-1)") == "" and value() == ""
    assert page.evaluate("document.querySelector('.rostrum-lookup-clear').hidden")
    # a value set by the site is shown without being taken again
    taken = page.evaluate("window.__taken.length")
    page.evaluate("window.__lookup.show('1111')")
    assert value() == "1111" and page.evaluate("window.__taken.length") == taken
    assert page.errors == []


@pytest.mark.heavy
def test_a_site_adds_its_switches_to_the_menu_of_the_frame(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate("()=>{window.__on=true;rostrum.options.switches=[{id:'own',label:'Own switch',get:()=>window.__on,set:on=>{window.__on=on;}}];}")
    page.evaluate("document.querySelector('#rostrumCorner').click()")
    pressed = "document.querySelector('#rostrumSettings [data-id=\"own\"]').getAttribute('aria-pressed')"
    assert page.evaluate(pressed) == "true"
    page.evaluate("document.querySelector('#rostrumSettings [data-id=\"own\"]').click()")
    assert page.evaluate("window.__on") is False and page.evaluate(pressed) == "false"
    assert page.errors == []


@pytest.mark.heavy
def test_charts_have_a_plain_look_from_the_engine(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.add_script_tag(url=demo_url.replace("demo/index.html", "charts.js"))
    look = page.evaluate(
        """()=>{const host=document.createElement('div');host.style.cssText='position:relative;width:400px;height:200px';document.getElementById('first').append(host);
          host.innerHTML=ChartCore.legend([{color:'red',label:'one'}])+`<svg width="10" height="10"><line class="${ChartCore.names.cross}"/></svg>`;
          const prism=ChartCore.prism(host,{W:400,H:200,gate:{x:10,w:20,top:10,height:100},rows:{x:200,top:10,height:30,viewport:180}});
          prism.draw({parts:[{key:'a',value:3,row:0,hot:true},{key:'b',value:1,row:1}],segment:null,animate:false});
          const style=sel=>getComputedStyle(host.querySelector(sel));
          return {legend:style(`.${ChartCore.names.legend}`).display,swatch:style(`.${ChartCore.names.legend} span span`).display,cross:style(`.${ChartCore.names.cross}`).strokeWidth,
            prism:style(`.${ChartCore.names.prism}`).position,lens:style('.lens').fill,part:style('.part:not(.hot)').fill,hot:style('.part.hot').fill};}"""
    )
    assert look["legend"] == "flex" and look["swatch"] == "inline-block" and look["cross"] == "1px" and look["prism"] == "absolute", look
    assert look["lens"] != "rgb(0, 0, 0)" and look["part"] != "rgb(0, 0, 0)" and look["hot"] != look["part"], look
    assert page.errors == []


@pytest.mark.heavy
def test_a_turn_of_the_wheel_that_ends_a_list_does_not_move_the_camera(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate("""()=>{const box=document.createElement('div');box.id='lane';box.style.cssText='height:120px;width:300px;margin-left:120px;overflow-y:auto';
      box.innerHTML='<div style="height:400px">rows</div>';document.getElementById('first').prepend(box);}""")
    x, y, w, h = page.evaluate(BOX, "#lane")
    goal = "[rostrum.camera.goalX,rostrum.camera.goalY]"
    resting = page.evaluate(goal)
    page.mouse.move(x + w / 2, y + h / 2)
    # the wheel goes on and on past the end of the list, as the inertia of a touchpad does
    page.evaluate("""()=>{const el=document.getElementById('lane');window.__wheel=setInterval(()=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true})),60);}""")
    page.mouse.wheel(0, 600)
    page.wait_for_timeout(700)
    page.evaluate("clearInterval(window.__wheel)")
    assert page.evaluate("(l=>l.scrollTop+l.clientHeight>=l.scrollHeight-1)(document.getElementById('lane'))")
    assert page.evaluate(goal) == resting, "the same turn stays with the list"
    # the next turn, after a pause, moves the camera
    page.wait_for_timeout(350)
    page.mouse.wheel(0, 120)
    page.wait_for_function(f"(g=>g[1]!=={resting[1]})({goal})", timeout=2000)
    assert page.errors == []


@pytest.mark.heavy
def test_a_lookup_marks_softly_a_value_longer_than_a_whole_one(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate(
        """async()=>{const {Lookup}=await import(new URL('../lookup.js',location.href).href);
          const host=document.createElement('div');host.style.margin='0 0 0 120px';const input=document.createElement('input');input.id='who';host.append(input);document.getElementById('first').prepend(host);
          window.__taken=[];new Lookup(input,{length:4,clean:text=>text.replace(/\\D/g,''),labels:{clear:'clear',over:n=>`${n} digits`},suggest:()=>[],
            choose:value=>window.__taken.push(value),facts:value=>`facts ${value}`,action:{label:'open',run:()=>{}}});}"""
    )
    x, y, w, h = page.evaluate(BOX, "#who")
    page.mouse.click(x + w / 2, y + h / 2)
    over = "document.querySelector('.rostrum-lookup').classList.contains('rostrum-lookup-over')"
    page.keyboard.insert_text("123")
    assert not page.evaluate(over)
    page.keyboard.insert_text("45")
    assert page.evaluate(over), "the digits stay, they are only marked"
    assert page.evaluate("document.querySelector('#who').value") == "12345"
    assert page.evaluate("document.querySelector('.rostrum-lookup-facts').textContent") == "5 digits"
    assert page.evaluate("window.__taken") == [], "a value too long is not taken"
    page.keyboard.press("Enter")
    assert page.evaluate("window.__taken") == [], "Enter does not take it either"
    page.keyboard.press("Backspace")
    assert not page.evaluate(over)
    assert page.evaluate("window.__taken") == ["1234"]
    page.keyboard.press("Backspace")
    page.evaluate("document.querySelector('#who').blur()")
    assert page.evaluate("document.querySelector('#who').value") == "1234", "half a value does not stay when the field is left"
    assert page.errors == []


def _digits_become(page, text):
    # moves of the pointer reach the page with the next frame
    page.wait_for_function(f"{_PERIOD_DIGITS}==='{text}'", timeout=3000)


def _hour_becomes(page, selector, text):
    page.wait_for_function(f"document.querySelector('{selector}').value==='{text}'", timeout=3000)


@pytest.mark.heavy
def test_a_first_date_is_taken_back_on_a_free_place_and_kept_while_switching_months(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    box = lambda selector: page.evaluate(BOX, selector)
    press = lambda selector, fx=0.5, fy=0.5: page.mouse.click(box(selector)[0] + box(selector)[2] * fx, box(selector)[1] + box(selector)[3] * fy)
    pending = lambda: page.evaluate("window.__picker.pending")
    day = page.evaluate("Date.UTC(2026,8,14)/1000")
    press(".rostrum-period-line")
    page.wait_for_selector(".rostrum-period-panel:not([hidden])")
    press(f'[data-day="{day}"]')
    assert pending() == day
    # switching what is shown keeps it, by a year, a month, the gap between two months or the wheel
    press('[data-year="-1"]')
    press('[data-year="1"]')
    press('[data-jump="2"]')
    first, second = box('[data-jump="3"]'), box('[data-jump="4"]')
    page.mouse.click((first[0] + first[2] + second[0]) / 2, first[1] + first[3] / 2)
    assert pending() == day, "the row of months has no free places"
    page.mouse.move(*box(".rostrum-period-readout")[:2])
    page.mouse.wheel(0, 240)
    assert pending() == day
    press('[data-jump="8"]')
    # the row of the days of the week is a free place, and what was chosen stays
    before = page.evaluate(_PERIOD_DIGITS)
    picks = page.evaluate("window.__picks.length")
    press(".rostrum-period-month th")
    assert pending() is None
    assert page.evaluate(_PERIOD_DIGITS) == before and page.evaluate("window.__picks.length") == picks
    # and a day still starts a new range
    press(f'[data-day="{day}"]')
    assert pending() == day
    assert page.errors == []


@pytest.mark.heavy
def test_what_the_readout_says_and_the_month_shown_do_not_move_the_calendar(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    box = lambda selector: page.evaluate(BOX, selector)
    x, y, w, h = box(".rostrum-period-line")
    page.mouse.click(x + w / 2, y + h / 2)
    page.wait_for_selector(".rostrum-period-panel:not([hidden])")
    size = lambda: [box(".rostrum-period-panel")[2:], box(".rostrum-period-dial")[1:3]]
    resting = size()
    page.evaluate("()=>{const p=window.__picker;p.options.summary=()=>'a long long long long long long long long long long long long long long long long long long long summary';p.paint();}")
    assert size() == resting, "the text of the readout wraps inside the width of the days"
    # august 2026 takes six weeks, february 2027 four
    for year, month in ((2026, 7), (2027, 1), (2026, 8)):
        page.evaluate(f"()=>{{const p=window.__picker;p.left={{year:{year},month:{month}}};p.render();}}")
        assert size() == resting, month
    assert page.errors == []


@pytest.mark.heavy
def test_a_length_typed_back_from_now_becomes_the_period(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    box = lambda selector: page.evaluate(BOX, selector)
    x, y, w, h = box(".rostrum-period-line")
    page.mouse.click(x + w / 2, y + h / 2)
    page.wait_for_selector(".rostrum-period-panel:not([hidden])")
    x, y, w, h = box(".rostrum-period-typed")
    page.mouse.click(x + w / 2, y + h / 2)
    page.keyboard.type("-90 m")
    page.keyboard.press("Enter")
    now = page.evaluate("Date.UTC(2026,9,31)/1000")
    assert page.evaluate("window.__picks.at(-1)") == {"from": now - 90 * 60, "to": now + 60}
    assert page.evaluate("document.querySelector('.rostrum-period-panel').hidden")
    assert page.errors == []


@pytest.mark.heavy
def test_the_hours_of_a_period_are_set_on_its_rulers(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    box = lambda selector: page.evaluate(BOX, selector)
    day = page.evaluate("Date.UTC(2026,8,14)/1000")
    camera = "[rostrum.camera.x,rostrum.camera.y]"
    x, y, w, h = box(".rostrum-period-line")
    page.mouse.click(x + w / 2, y + h / 2)
    page.wait_for_selector(".rostrum-period-panel:not([hidden])")
    resting = page.evaluate(camera)
    for _ in range(2):
        x, y, w, h = box(f'[data-day="{day}"]')
        page.mouse.click(x + w / 2, y + h / 2)
    assert page.evaluate("document.querySelectorAll('.rostrum-period-ruler:not([hidden])').length") == 1, "one day is one ruler"
    _digits_become(page, "14 09 2026 00 00 14 09 2026 23 59")
    x, y, w, h = box(".rostrum-period-ruler:not([hidden]) .rostrum-period-dial")
    at = lambda hour: x + w * hour / 24
    middle = y + h / 2
    # a pull over the hours draws them anew, the digits follow and the period is taken when it is let go
    page.mouse.move(at(6), middle)
    page.mouse.down()
    page.mouse.move(at(9), middle, steps=3)
    page.mouse.move(at(12), middle, steps=3)
    _digits_become(page, "14 09 2026 06 00 14 09 2026 12 00")
    page.mouse.up()
    assert page.evaluate("window.__picker.window") == {"from": day + 6 * 3600, "to": day + 12 * 3600 + 60}
    # the end of a period is pulled by itself
    page.mouse.move(at(12), middle)
    page.mouse.down()
    page.mouse.move(at(18), middle, steps=4)
    page.mouse.up()
    _digits_become(page, "14 09 2026 06 00 14 09 2026 18 00")
    # and it does not pass the other end
    page.mouse.move(at(18), middle)
    page.mouse.down()
    page.mouse.move(at(2), middle, steps=4)
    page.mouse.up()
    _digits_become(page, "14 09 2026 06 00 14 09 2026 06 00")
    # two ends on one place: the one that can go where it is pulled
    page.mouse.move(at(6), middle)
    page.mouse.down()
    page.mouse.move(at(4), middle, steps=4)
    page.mouse.up()
    _digits_become(page, "14 09 2026 04 00 14 09 2026 06 00")
    page.mouse.move(at(6), middle)
    page.mouse.down()
    page.mouse.move(at(20), middle, steps=4)
    page.mouse.up()
    _digits_become(page, "14 09 2026 04 00 14 09 2026 20 00")
    # a press without a pull brings the nearer end
    page.mouse.click(at(3), middle)
    _digits_become(page, "14 09 2026 03 00 14 09 2026 20 00")
    # the wheel moves an end finer than the pointer
    picks = page.evaluate("window.__picks.length")
    page.mouse.move(at(20), middle)
    page.mouse.wheel(0, -120)
    _digits_become(page, "14 09 2026 03 00 14 09 2026 20 05")
    # an hour under the pointer says what happened in it
    page.mouse.move(at(14.5), middle)
    page.wait_for_function("document.querySelector('.rostrum-period-readout').textContent.endsWith('n=3')", timeout=3000)
    # two days are two rulers, each with its end
    other = day + 2 * 86400
    for d in (day, other):
        cx, cy, cw, ch = box(f'[data-day="{d}"]')
        page.mouse.click(cx + cw / 2, cy + ch / 2)
    assert page.evaluate("document.querySelectorAll('.rostrum-period-ruler:not([hidden])').length") == 2
    dials = page.evaluate("[...document.querySelectorAll('.rostrum-period-ruler:not([hidden]) .rostrum-period-dial')].map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})")
    page.mouse.click(dials[0][0] + dials[0][2] / 2, dials[0][1] + dials[0][3] / 2)
    page.mouse.click(dials[1][0] + dials[1][2] / 4, dials[1][1] + dials[1][3] / 2)
    _digits_become(page, "14 09 2026 12 00 16 09 2026 06 00")
    assert page.evaluate(camera) == resting, "the rulers do not move the camera"
    # nothing of it reaches the site until the calendar is left, and then once
    assert page.evaluate("window.__picks.length") == picks
    page.mouse.click(5, 5)
    assert page.evaluate("window.__picks.length") == picks + 1
    assert page.evaluate("window.__picks.at(-1)") == {"from": day + 12 * 3600, "to": other + 6 * 3600 + 60}
    page.wait_for_timeout(700)
    assert page.evaluate("window.__picks.length") == picks + 1, "a finer step that was waiting adds nothing"
    assert page.errors == []


@pytest.mark.heavy
def test_a_period_is_told_when_the_calendar_is_left_and_taken_back_by_escape(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    box = lambda selector: page.evaluate(BOX, selector)
    day = lambda d: page.evaluate(f"Date.UTC(2026,8,{d})/1000")
    picks = lambda: page.evaluate("window.__picks.length")
    def open_calendar():
        x, y, w, h = box(".rostrum-period-line")
        page.mouse.click(x + w / 2, y + h / 2)
        page.wait_for_selector(".rostrum-period-panel:not([hidden])")
    def choose(a, b):
        for d in (a, b):
            x, y, w, h = box(f'[data-day="{day(d)}"]')
            page.mouse.click(x + w / 2, y + h / 2)
    start = page.evaluate(_PERIOD_DIGITS)
    told = picks()
    # escape takes it back
    open_calendar()
    choose(14, 16)
    _digits_become(page, "14 09 2026 00 00 16 09 2026 23 59")
    assert picks() == told
    page.keyboard.press("Escape")
    assert page.evaluate("document.querySelector('.rostrum-period-panel').hidden")
    _digits_become(page, start)
    assert picks() == told
    # a period the site sets meanwhile does not push away what is being chosen
    open_calendar()
    choose(14, 16)
    page.evaluate("window.__picker.show(Date.UTC(2026,8,1)/1000,Date.UTC(2026,8,2)/1000)")
    _digits_become(page, "14 09 2026 00 00 16 09 2026 23 59")
    # the line closes the calendar too, and leaving says the period
    x, y, w, h = box(".rostrum-period-line")
    page.mouse.click(x + w / 2, y + h / 2)
    assert picks() == told + 1
    assert page.evaluate("window.__picks.at(-1)") == {"from": day(14), "to": day(17)}
    # left without a change nothing is said
    open_calendar()
    page.mouse.click(5, 5)
    assert picks() == told + 1
    # digits typed with the calendar open wait for it too
    open_calendar()
    x, y, w, h = box('.rostrum-period-end[data-side=from] [data-part=hour]')
    page.mouse.click(x + w / 2, y + h / 2)
    page.keyboard.type("10")
    page.keyboard.press("Enter")
    assert picks() == told + 1
    page.mouse.click(5, 5)
    assert picks() == told + 2
    assert page.evaluate("window.__picks.at(-1).from") == day(14) + 10 * 3600
    # a preset is the whole of the answer, what was being chosen is dropped
    open_calendar()
    choose(20, 21)
    page.evaluate("document.querySelector('[data-preset=\"0\"]').click()")
    assert page.evaluate("window.__picks.at(-1)") == "preset"
    assert picks() == told + 3
    # with the calendar closed the digits are said at once
    x, y, w, h = box('.rostrum-period-end[data-side=from] [data-part=hour]')
    page.mouse.click(x + w / 2, y + h / 2)
    page.keyboard.type("11")
    page.keyboard.press("Enter")
    assert picks() == told + 4
    assert page.errors == []


@pytest.mark.heavy
def test_the_animation_of_wiping_a_selection_exists_and_destroy_reports_no_lost_table(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    frames = page.evaluate("""()=>[...document.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>r.type===CSSRule.KEYFRAMES_RULE).map(r=>r.name)""")
    assert "rostrum-selection-wipe" in frames, "a keyframes rule inside a nested block is dropped by the browser"
    said = page.evaluate("""()=>new Promise(resolve=>{const said=[];rostrum.options.report=name=>said.push(name);rostrum.destroy();setTimeout(()=>resolve(said),300);})""")
    assert said == []


@pytest.mark.heavy
def test_work_of_a_tab_takes_its_turns_between_the_frames_of_a_flight(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    at_rest = page.evaluate("""()=>{let ran=0;rostrum.later('a',()=>{ran++;});return {ran,busy:rostrum.lazy.busy};}""")
    assert at_rest == {"ran": 1, "busy": False}, "at rest a piece runs at once"
    done = page.evaluate("""()=>new Promise(resolve=>{
        window.__ran=[];rostrum.open('details');
        const air=!!rostrum.flight,hover=rostrum.plane.style.pointerEvents;
        rostrum.later('chart',()=>window.__ran.push('old'));
        rostrum.later('table',()=>window.__ran.push('table'));
        rostrum.later('chart',()=>window.__ran.push('new'));
        const sync=window.__ran.length;
        rostrum.turn().then(()=>window.__ran.push('turn'));
        rostrum.lazy.drained().then(()=>resolve({air,hover,sync,ran:window.__ran,flying:!!rostrum.flight}));
    })""")
    assert done["air"] and done["hover"] == "none", "what passes under the pointer is not hovered"
    assert done["sync"] == 0, "nothing runs in the task that asked for it"
    assert done["ran"] == ["new", "table", "turn"], "a key keeps its place and runs its newest work, the turns go in order"
    assert done["flying"], "a short queue is done before the landing"
    page.wait_for_function("!rostrum.flight", timeout=20000)
    assert page.evaluate("rostrum.plane.style.pointerEvents") == ""
    assert page.errors == []


@pytest.mark.heavy
def test_a_tab_is_held_until_its_pieces_have_run(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    page.evaluate("""()=>rostrum.open('details',()=>rostrum.holdDrawing('details',Promise.resolve().then(()=>{
        rostrum.later('slow',()=>{window.__heldAtPiece=rostrum.holds.has('details');});})))""")
    page.wait_for_function("window.__heldAtPiece!==undefined", timeout=20000)
    assert page.evaluate("window.__heldAtPiece") is True
    page.wait_for_function("!rostrum.flight&&!rostrum.holds.size", timeout=20000)
    assert page.errors == []


@pytest.mark.heavy
def test_a_press_that_leaves_its_digits_does_not_stay_on_the_pointer(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    hour = '.rostrum-period-end[data-side=from] [data-part=hour]'
    x, y, w, h = page.evaluate(BOX, hour)
    digits = f"document.querySelector('{hour}').value"
    was = page.evaluate(digits)
    page.mouse.move(x + w / 2, y + h / 2)
    page.mouse.down()
    page.mouse.move(x + w / 2, y + h + 120)
    page.mouse.up()
    assert page.evaluate("window.__picker.pull") is None
    page.mouse.move(x + w / 2, y + h / 2)
    page.mouse.move(x + w / 2, y + h / 2 - 40, steps=4)
    assert page.evaluate(digits) == was, "a pointer with no button turns nothing"
    assert page.errors == []


@pytest.mark.heavy
def test_escape_during_a_pull_of_the_hours_tells_the_site_nothing(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    x, y, w, h = page.evaluate(BOX, ".rostrum-period-line")
    page.mouse.click(x + w / 2, y + h / 2)
    page.wait_for_selector(".rostrum-period-panel:not([hidden])")
    x, y, w, h = page.evaluate(BOX, ".rostrum-period-ruler:not([hidden]) .rostrum-period-dial")
    picks = page.evaluate("window.__picks.length")
    page.mouse.move(x + w * 0.25, y + h / 2)
    page.mouse.down()
    page.mouse.move(x + w * 0.5, y + h / 2, steps=3)
    page.keyboard.press("Escape")
    assert page.evaluate("window.__picker.clock.held") is None
    page.mouse.up()
    page.wait_for_timeout(100)
    assert page.evaluate("window.__picks.length") == picks
    assert page.errors == []


@pytest.mark.heavy
def test_a_group_of_digits_is_pulled_up_and_down_and_taken_when_let_go(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    box = lambda selector: page.evaluate(BOX, selector)
    hour = '.rostrum-period-end[data-side=from] [data-part=hour]'
    camera = "[rostrum.camera.x,rostrum.camera.y]"
    resting = page.evaluate(camera)
    x, y, w, h = box(hour)
    picks = page.evaluate("window.__picks.length")
    page.mouse.move(x + w / 2, y + h / 2)
    page.mouse.down()
    page.mouse.move(x + w / 2, y + h / 2 - 4)
    page.mouse.move(x + w / 2, y + h / 2 - 16)
    _hour_becomes(page, hour, "02")
    page.mouse.move(x + w / 2, y + h / 2 + 2)
    _hour_becomes(page, hour, "23")
    page.wait_for_timeout(700)
    assert page.evaluate("window.__picks.length") == picks, "nothing is taken while it is held"
    page.mouse.up()
    assert page.evaluate("window.__picks.length") == picks + 1
    assert page.evaluate("window.__picks.at(-1).from") == page.evaluate("Date.UTC(2026,8,10,23)/1000")
    assert page.evaluate(camera) == resting
    # a press without a pull changes nothing and leaves the group to type in
    picks = page.evaluate("window.__picks.length")
    page.mouse.click(x + w / 2, y + h / 2)
    _hour_becomes(page, hour, "23")
    assert page.evaluate("document.activeElement.dataset.part") == "hour"
    assert page.evaluate("window.__picks.length") == picks
    assert page.errors == []


@pytest.mark.heavy
def test_the_line_of_a_period_made_on_a_hidden_tab_is_drawn_when_the_tab_is_shown(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    drawn = page.evaluate(
        """async()=>{const shell=document.createElement('div');shell.style.display='none';const host=document.createElement('div');shell.append(host);document.getElementById('first').prepend(shell);
          const options={...window.__options,load:async()=>({buckets:[]})},picker=new window.__PeriodPicker(host,options),day=Date.UTC(2026,8,10)/1000;
          picker.show(day,day+86400);await picker.refresh();
          shell.style.display='';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const canvas=host.querySelector('.rostrum-period-line canvas');
          return canvas.width>0&&canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some(v=>v>0);}"""
    )
    assert drawn, "a period without events still shows the line to press"
    assert page.errors == []


@pytest.mark.heavy
def test_a_period_is_chosen_on_the_calendar_and_typed_exactly_in_its_digits(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    _period_picker(page)
    digits = _PERIOD_DIGITS
    assert page.evaluate(digits) == "10 09 2026 00 00 11 09 2026 23 59"
    assert page.evaluate("document.querySelector('.rostrum-period-length').textContent") == "2d"
    box = lambda selector: page.evaluate(BOX, selector)
    # the line between the ends opens the calendar
    x, y, w, h = box(".rostrum-period-line")
    page.mouse.click(x + w / 2, y + h / 2)
    page.wait_for_selector(".rostrum-period-panel:not([hidden])")
    seasons = page.evaluate("[...document.querySelectorAll('.rostrum-period-years [data-jump]')].map(e=>e.dataset.season)")
    assert seasons == ["winter"] * 2 + ["spring"] * 3 + ["summer"] * 3 + ["autumn"] * 3 + ["winter"]
    colors = page.evaluate("Object.fromEntries([0,3,6,9].map(m=>{const b=document.querySelector(`[data-jump=\"${m}\"]`);return [b.dataset.season,getComputedStyle(b).getPropertyValue('--rostrum-season').trim()];}))")
    assert len(set(colors.values())) == 4 and all(colors.values()), colors
    cell = lambda d: f'[data-day="{d}"]'
    day = lambda d: page.evaluate(f"Date.UTC(2026,8,{d})/1000")
    assert page.evaluate(f"document.querySelector('{cell(day(10))}').querySelector('i')!==null"), "a day says what happened in it"
    assert page.evaluate(f"document.querySelector('{cell(day(11))}').classList.contains('rostrum-day-in')")
    # two presses make a range and the digits follow
    for d in (14, 16):
        x, y, w, h = box(cell(day(d)))
        page.mouse.move(x + w / 2, y + h / 2)
        page.mouse.down()
        page.mouse.up()
    assert page.evaluate(digits) == "14 09 2026 00 00 16 09 2026 23 59"
    assert not page.evaluate("document.querySelector('.rostrum-period-panel').hidden"), "the hours are the next thing to set"
    page.mouse.click(5, 5)
    assert page.evaluate("document.querySelector('.rostrum-period-panel').hidden")
    # digits are typed group after group, and leaving them says them
    picks = page.evaluate("window.__picks.length")
    x, y, w, h = box('.rostrum-period-end[data-side=from] [data-part=hour]')
    page.mouse.click(x + w / 2, y + h / 2)
    page.keyboard.type("1230")
    assert page.evaluate("document.activeElement.dataset.part") == "day", "after the last group of an end comes the first of the other"
    page.keyboard.press("Enter")
    assert page.evaluate("window.__picks.length") == picks + 1
    assert page.evaluate("window.__picks.at(-1).from") == day(14) + 12.5 * 3600
    # the wheel turns a group, the steps are taken together
    x, y, w, h = box('.rostrum-period-end[data-side=to] [data-part=day]')
    page.mouse.move(x + w / 2, y + h / 2)
    page.mouse.wheel(0, -120)
    page.mouse.wheel(0, -120)
    assert page.evaluate("document.querySelector('.rostrum-period-end[data-side=to] [data-part=day]').value") == "18"
    page.wait_for_function(f"window.__picks.length==={picks + 2}", timeout=3000)
    assert page.evaluate("window.__picks.at(-1).to") == day(19)
    # what is not a time is said to be wrong and nothing is picked
    page.evaluate("()=>{const t=document.querySelector('.rostrum-period-end[data-side=from] [data-part=hour]');t.focus();t.value='99';t.dispatchEvent(new Event('input'));t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));}")
    assert page.evaluate("window.__picks.length") == picks + 2
    assert page.evaluate("document.querySelector('.rostrum-period-said').textContent") == "bad"
    assert page.evaluate("document.querySelector('.rostrum-period-end[data-side=from] [data-part=hour]').classList.contains('rostrum-period-bad')")
    assert page.errors == []


@pytest.mark.heavy
def test_the_light_of_an_object_rises_to_its_level_and_never_above(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    samples = page.evaluate(
        """()=>{const el=document.createElement('div'),at=1000;rostrum.fx.born.set(el,at);
          return Array.from({length:60},(_,i)=>rostrum.fx.rampOf(el,at+i*20));}"""
    )
    assert samples == sorted(samples) and max(samples) <= 1
    assert page.errors == []


@pytest.mark.heavy
def test_a_flight_carries_only_the_light_of_outlines_and_a_tab_is_drawn_as_it_lands(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    state = page.evaluate(
        """()=>new Promise(resolve=>{rostrum.open('details',()=>rostrum.holdDrawing('details',Promise.resolve()));
          setTimeout(()=>{const els=rostrum.options.surfaces(rostrum.sectionOf('details'));
            resolve({flying:!!rostrum.flight,seen:els.length,struck:els.filter(e=>rostrum.fx.struck(e)).length,drawn:els.filter(e=>e.matches('.rostrum-lit')).length,held:rostrum.sectionOf('details').matches('.rostrum-held')});},250);})"""
    )
    assert state["flying"] and state["seen"] and state["struck"] and state["drawn"] == 0 and state["held"], state
    page.wait_for_function("!rostrum.flight", timeout=20000)
    page.wait_for_function("document.querySelectorAll('.rostrum-held').length===0", timeout=5000)
    assert page.evaluate("rostrum.options.surfaces(rostrum.sectionOf('details')).some(e=>e.matches('.rostrum-lit'))")
    assert page.errors == []


@pytest.mark.heavy
def test_words_not_written_yet_leave_no_shadow_and_their_glow_comes_back(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    during = page.evaluate(
        """()=>{const el=document.getElementById('first');el.insertAdjacentHTML('beforeend','<p id="glowing" style="text-shadow:0 0 9px red">words</p>');
          const p=document.getElementById('glowing');rostrum.writing.write(p,300);return getComputedStyle(p).textShadow;}"""
    )
    assert during == "none"
    page.wait_for_function("!document.getElementById('glowing').matches('.rostrum-unwritten')", timeout=5000)
    page.wait_for_timeout(450)
    assert page.evaluate("getComputedStyle(document.getElementById('glowing')).textShadow") != "none"
    assert page.errors == []


@pytest.mark.heavy
def test_a_hand_holds_its_own_layer_and_leaves_no_selection(chromium, demo_url):
    page = _demo(chromium, demo_url)
    page.mouse.move(1000, 700)
    page.mouse.down()
    page.mouse.move(900, 650, steps=4)
    assert page.evaluate("[getComputedStyle(document.getElementById('rostrumGrab')).display,getComputedStyle(document.getElementById('rostrumGrab')).cursor,document.documentElement.classList.contains('rostrum-carrying')]") == ["block", "grabbing", False]
    page.mouse.up()
    assert page.evaluate("[getComputedStyle(document.getElementById('rostrumGrab')).display,getSelection().isCollapsed]") == ["none", True]
    assert page.errors == []


@pytest.mark.heavy
def test_the_tabs_around_the_open_one_get_ready_while_the_camera_rests(chromium, demo_url):
    page = _demo(chromium, demo_url)
    table = "document.querySelector('rostrum-table').rostrum"
    page.wait_for_function(f"{table}.neighbours.ready.has('about')&&{table}.neighbours.ready.has('contact')", timeout=15000)
    # ready, out of view, costing a frame nothing, and it is not fed or counted as shown
    assert page.evaluate(f"[getComputedStyle(document.getElementById('t-about')).contentVisibility,{table}.neighbours.inView.has('about'),{table}.neighbours.drawnOnce.has('about')]") == ["hidden", False, False]
    assert page.errors == []


def test_no_animation_moves_a_clip_and_a_filter_together():
    # after one such animation the first 3D frame of the camera over that tab kills it, STATUS_BREAKPOINT on Intel Iris Xe, software GL does not show it
    for path in ROSTRUM.glob("*.js"):
        for animate in re.findall(r"\.animate\(\[.*?\]\s*,", path.read_text(encoding="utf-8"), re.S):
            assert not ("clipPath" in animate and "filter" in animate), f"{path.name}: {animate[:120]}"


@pytest.mark.heavy
def test_a_flight_goes_over_the_table_with_both_tabs_on_it_and_lands_flat(chromium, demo_url):
    page = _demo(chromium, demo_url)
    table = "document.querySelector('rostrum-table').rostrum"

    page.click('.rostrum-rail button[data-tab="about"]', no_wait_after=True)
    # both ends lie on the table on the way
    assert page.evaluate(f"[!!{table}.flight,{table}.tab,[...{table}.neighbours.inView]]") == [True, "about", ["work"]]
    page.wait_for_function(f"{table}.camera.h>2640", timeout=20000)
    assert "rotateX" in page.evaluate(f"{table}.plane.style.transform")
    page.wait_for_function(f"!{table}.flight", timeout=20000)
    state = page.evaluate(f"[!!{table}.flight,{table}.camera.tilt,{table}.camera.h,{table}.plane.style.transform]")
    assert state[:3] == [False, 0, 2400] and state[3].startswith("translate(") and "perspective" not in state[3]
    home = page.evaluate(f"(()=>{{const h={table}.camera.home('about');return [h.x,h.y]}})()")
    assert page.evaluate(f"[{table}.camera.x,{table}.camera.y]") == home

    # the next tab asked for on the way turns the camera in the air, it lands there
    page.click('.rostrum-rail button[data-tab="contact"]', no_wait_after=True)
    page.wait_for_function(f"{table}.camera.h>2880", timeout=20000)
    page.click('.rostrum-rail button[data-tab="work"]', no_wait_after=True)
    page.wait_for_function(f"{table}.tab==='work'&&!{table}.flight", timeout=20000)
    assert page.evaluate(f"[!!{table}.flight,{table}.tab,{table}.camera.tilt,{table}.camera.h]") == [False, "work", 0, 2400]
    home = page.evaluate(f"(()=>{{const h={table}.camera.home('work');return [h.x,h.y]}})()")
    assert page.evaluate(f"[{table}.camera.x,{table}.camera.y]") == home
    assert page.errors == []


@pytest.mark.heavy
def test_the_camera_walks_over_to_the_next_tab_in_every_direction(chromium, demo_url):
    page = _demo(chromium, demo_url)
    table = "document.querySelector('rostrum-table').rostrum"
    place = f"Object.fromEntries([...{table}.zones].map(([t,z])=>[t,[z.x,z.y]]))"
    assert page.evaluate(place) == {"bench": [0, 0], "work": [3000, 0], "about": [6000, 0], "contact": [3000, 3000]}
    page.mouse.move(700, 450)

    # to the right: the tab shows long before it opens, opening it does not move the camera
    page.mouse.wheel(1800, 0)
    page.wait_for_function(f"{table}.neighbours.inView.has('about')", timeout=10000)
    assert page.evaluate(f"{table}.tab") == "work"
    assert page.evaluate("getComputedStyle(document.getElementById('t-about')).display") == "block"
    # it rests here for a moment, so this is the place of the tab from now on
    page.wait_for_function(f"Math.abs({table}.camera.x-{table}.camera.goalX)<1", timeout=10000)
    page.wait_for_timeout(500)
    for _ in range(4):
        page.mouse.wheel(600, 0)
        page.wait_for_timeout(120)
    page.wait_for_function(f"{table}.tab==='about'", timeout=10000)
    assert page.evaluate(f"[{table}.tab,!!{table}.flight]") == ["about", False]
    assert page.evaluate("document.querySelector('.rostrum-title').textContent") == "About"
    home = page.evaluate(f"{table}.camera.home('work').x")
    assert page.evaluate(f"{table}.camera.goalX") == home + 1800 + 4 * 600, "the camera stays where the hand took it"

    # a press on the rail comes back to where the camera rested on that tab, one more press goes home, and down there is the tab below
    page.click('.rostrum-rail button[data-tab="work"]', no_wait_after=True)
    page.wait_for_function(f"{table}.tab==='work'&&!{table}.flight", timeout=20000)
    assert page.evaluate(f"{table}.camera.goalX") >= home + 1800, "the place on a tab is kept"
    page.click('.rostrum-rail button[data-tab="work"]', no_wait_after=True)
    page.wait_for_function(f"Math.abs({table}.camera.x-{table}.camera.home('work').x)<2", timeout=10000)
    page.mouse.move(700, 450)
    for _ in range(8):
        page.mouse.wheel(0, 500)
        page.wait_for_timeout(120)
    page.wait_for_function(f"{table}.tab==='contact'", timeout=10000)
    # the objects of a tab know their own arrangement whichever tab is open
    assert page.evaluate(f"{table}.objectOf(document.querySelector('{NOW}')).arrangement")
    assert page.errors == []


@pytest.mark.heavy
@pytest.mark.parametrize("act", ["move", "size"])
def test_nothing_of_the_menu_stays_after_a_hand_that_rested(chromium, demo_url, act):
    page = _demo(chromium, demo_url)
    _open_menu(page, NOW)
    _act(page, act)
    page.mouse.move(760, 520, steps=6)
    # long enough for the watch over the field to go to sleep
    page.wait_for_timeout(3000)
    page.mouse.click(760, 520)
    page.mouse.move(300, 860)
    page.wait_for_timeout(1500)
    assert page.evaluate(NO_BLUR) == 0
    assert page.evaluate("document.getElementById('rostrumReadout')") is None
    assert page.errors == []


@pytest.mark.heavy
def test_the_verbs_of_an_object_are_whole_acts(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    state = page.evaluate(
        """()=>{const el=document.getElementById('second'),o=rostrum.objectOf(el);
          o.moveTo(1200,700);
          const moved=[el.style.left,el.style.top,JSON.parse(localStorage.getItem('api-test.rostrumSpots.overview')).second.x];
          o.setSize(500,300);
          const sized=[el.style.width,el.style.height,JSON.parse(localStorage.getItem('api-test.rostrumSizes.overview')).second.w];
          o.setScale(1.5);
          return {moved,sized,zoom:el.style.zoom};}"""
    )
    assert state == {"moved": ["1200px", "700px", 1200], "sized": ["500px", "300px", 500], "zoom": "1.5"}
    assert page.errors == []


@pytest.mark.heavy
def test_destroy_takes_everything_off_the_elements(chromium, demo_url):
    page = _api_page(chromium, demo_url)
    left = page.evaluate(
        """()=>{const {frame,plane}=rostrum;rostrum.destroy();return {
          classes:document.querySelectorAll('.rostrum-on-table,.rostrum-open,.rostrum-ready,.rostrum-in-view,.rostrum-over').length,
          attributes:[frame.dataset.rostrumFrame,plane.dataset.rostrumPlane,document.documentElement.dataset.rostrumCompact].filter(v=>v!==undefined).length,
          style:document.getElementById('first').getAttribute('style')};}"""
    )
    assert left == {"classes": 0, "attributes": 0, "style": "padding: 20px;"}
    assert page.errors == []


@pytest.mark.heavy
def test_without_the_table_everything_else_works(chromium, demo_url):
    page = chromium.new_context(viewport={"width": 1440, "height": 900}).new_page()
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(demo_url, wait_until="load")
    page.wait_for_selector(f"{NOW}.rostrum-on-table", timeout=30000)
    # the old table goes first, its destroy takes the marks off the root
    page.evaluate("document.querySelector('rostrum-table').remove()")
    page.evaluate("""()=>{
      document.body.insertAdjacentHTML('beforeend',`<rostrum-table storage="noscene." options='{"scene":false}'><rostrum-tab name="a" title="A"><rostrum-object name="o">x</rostrum-object></rostrum-tab><rostrum-tab name="b" title="B"><rostrum-object name="p">y</rostrum-object></rostrum-tab></rostrum-table>`);}""")
    page.wait_for_selector('rostrum-object[name="o"].rostrum-on-table', timeout=10000)
    table = "document.querySelector('rostrum-table').rostrum"
    assert page.evaluate(f"[{table}.scene.gl,{table}.maps.items.length]") == [None, 1]
    page.click('.rostrum-rail button[data-tab="b"]', no_wait_after=True)
    assert page.evaluate(f"!!{table}.flight")
    page.wait_for_function(f"{table}.tab==='b'&&!{table}.flight", timeout=20000)
    page.wait_for_function(f"{table}.neighbours.ready.has('a')", timeout=15000)
    assert errors == []


@pytest.mark.heavy
def test_the_compact_look_follows_compact_width_and_not_a_fixed_number(chromium, demo_url):
    page = chromium.new_context(viewport={"width": 900, "height": 700}).new_page()
    page.goto(demo_url, wait_until="load")
    page.wait_for_selector(f"{NOW}.rostrum-on-table", timeout=30000)
    assert page.evaluate("document.documentElement.hasAttribute('data-rostrum-compact')") is False
    # the old table goes first, its destroy takes the marks off the root
    page.evaluate("document.querySelector('rostrum-table').remove()")
    page.evaluate("""()=>{
      document.body.insertAdjacentHTML('beforeend',`<rostrum-table storage="wide." options='{"compactWidth":1000}'><rostrum-tab name="a" title="A"><rostrum-object name="o">x</rostrum-object></rostrum-tab></rostrum-table>`);}""")
    page.wait_for_selector('rostrum-object[name="o"].rostrum-on-table', timeout=10000)
    assert page.evaluate("[document.documentElement.hasAttribute('data-rostrum-compact'),getComputedStyle(document.querySelector('.rostrum-table-map')).display]") == [True, "none"]
