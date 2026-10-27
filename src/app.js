/* What to Watch. One home page for Floyd's streaming services (US): popular and new titles filtered to
   the services they have, "For you" picks built from titles they ♥, browse, search, and a title page
   that opens the service. Listings and availability come from the TMDB API (availability is JustWatch
   data); Floyd pastes their own free TMDB key in Settings. Everything stays in this phone's storage. */
PH.init({ posters: true, svc_hulu: true, svc_prime: true, svc_peacock: true,
          homeSvc: 'all', brSvc: 'all', brType: 'movie', brGenre: '', brSort: 'popular' });
(() => {
  const $ = s => document.querySelector(s);
  const KEY = 'what-to-watch:data:';   // every tool shares bgriffie.github.io, so keys are prefixed
  const CKEY = 'what-to-watch:c:';     // cached TMDB answers (trimmed), pruned to the newest 90
  const load = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HOUR = 36e5, DAY = 24 * HOUR;
  const REGION = 'US';

  /* ---------- Services ---------- */
  // Provider ids are looked up by name from TMDB at runtime; these are the fallbacks.
  const SERVICES = [
    { id: 'hulu', name: 'Hulu', short: 'Hulu', match: /^hulu$/i, ids: [15],
      open: t => 'https://www.hulu.com/search?q=' + encodeURIComponent(t) },
    { id: 'prime', name: 'Prime Video', short: 'Prime', match: /^amazon prime video( with ads)?$/i, ids: [9, 2100],
      open: t => 'https://www.primevideo.com/search/ref=atv_nb_sr?phrase=' + encodeURIComponent(t) },
    { id: 'peacock', name: 'Peacock', short: 'Peacock', match: /^peacock/i, ids: [386, 387],
      open: t => 'https://www.peacocktv.com/watch/search?q=' + encodeURIComponent(t) },
  ];
  const SVC = Object.fromEntries(SERVICES.map(s => [s.id, s]));
  const active = () => SERVICES.filter(s => PH.store.get('svc_' + s.id));
  const tagHtml = ids => ids.map(id => `<span class="tag s-${id}">${SVC[id].short}</span>`).join('');

  /* ---------- TMDB ---------- */
  let apiKey = load('key', '');
  const isToken = k => k.length > 60;   // v4 Read Access Token (JWT) vs v3 API key
  const mem = new Map();

  function cacheGet(url) {
    if (mem.has(url)) return mem.get(url);
    try { const v = JSON.parse(localStorage.getItem(CKEY + url)); if (v) mem.set(url, v); return v; } catch { return null; }
  }
  function cachePut(url, d, persist) {
    const v = { t: Date.now(), d };
    mem.set(url, v);
    if (!persist) return;
    try { localStorage.setItem(CKEY + url, JSON.stringify(v)); } catch { prune(30); }
    if (Math.random() < .15) prune(90);
  }
  function prune(keep) {
    const ks = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(CKEY)) ks.push(k); }
    if (ks.length <= keep) return;
    const age = k => { try { return JSON.parse(localStorage.getItem(k)).t || 0; } catch { return 0; } };
    ks.map(k => [age(k), k]).sort((a, b) => b[0] - a[0]).slice(keep).forEach(([, k]) => localStorage.removeItem(k));
  }
  function clearCache() {
    mem.clear(); provMap = {};
    const ks = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(CKEY)) ks.push(k); }
    ks.forEach(k => localStorage.removeItem(k));
    save('prov', {});
  }

  // GET a TMDB path. `trim` shrinks the answer before it is cached; `persist` keeps it across launches.
  // If TMDB can't be reached, a stale cached answer is used instead.
  async function tmdb(path, params = {}, { ttl = 6 * HOUR, persist = true, trim = d => d } = {}) {
    if (!apiKey) throw new Error('Add your TMDB key in Settings.');
    const qs = new URLSearchParams(params).toString();
    const url = path + (qs ? '?' + qs : '');
    const hit = cacheGet(url);
    if (hit && Date.now() - hit.t < ttl) return hit.d;
    let r;
    try {
      const full = 'https://api.themoviedb.org/3' + url + (isToken(apiKey) ? '' : (qs ? '&' : '?') + 'api_key=' + encodeURIComponent(apiKey));
      r = await fetch(full, { headers: isToken(apiKey) ? { Authorization: 'Bearer ' + apiKey, accept: 'application/json' } : { accept: 'application/json' } });
    } catch {
      if (hit) return hit.d;
      throw new Error(navigator.onLine === false ? 'No internet connection.' : 'Can\'t reach TMDB right now.');
    }
    if (r.status === 401) throw new Error('TMDB rejected the key. Check it in Settings.');
    if (r.status === 404) throw new Error('TMDB doesn\'t have that title.');
    if (!r.ok) { if (hit) return hit.d; throw new Error('TMDB error ' + r.status + '.'); }
    const d = trim(await r.json());
    cachePut(url, d, persist);
    return d;
  }

  // A film or show, trimmed to what the cards need
  const norm = (r, type) => ({
    id: r.id, type: r.media_type || type, title: r.title || r.name || 'Untitled',
    year: (r.release_date || r.first_air_date || '').slice(0, 4), poster: r.poster_path || '',
    pop: r.popularity || 0, vote: r.vote_average || 0,
  });
  const ikey = it => it.type + '-' + it.id;
  const known = new Map();   // ikey -> item, so a tapped card opens instantly
  const trimList = d => ({ results: (d.results || []).filter(r => !r.adult && (r.media_type ? /^(movie|tv)$/.test(r.media_type) : true)).map(r => norm(r, r.media_type)), total: d.total_pages || 1 });

  // Provider ids per service, by name from TMDB (cached a week)
  let provIds = null;
  async function providerIds() {
    if (provIds) return provIds;
    const ids = Object.fromEntries(SERVICES.map(s => [s.id, new Set(s.ids)]));
    try {
      for (const type of ['movie', 'tv']) {
        const d = await tmdb('/watch/providers/' + type, { watch_region: REGION }, { ttl: 7 * DAY,
          trim: d => ({ results: (d.results || []).map(p => ({ id: p.provider_id, name: p.provider_name })) }) });
        d.results.forEach(p => SERVICES.forEach(s => { if (s.match.test(p.name)) ids[s.id].add(p.id); }));
      }
    } catch (e) { if (/key/.test(e.message)) throw e; }
    provIds = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, [...v]]));
    return provIds;
  }
  const svcOfProvider = (pid, ids) => SERVICES.find(s => ids[s.id].includes(pid))?.id;

  // Which of the services a title is on (cached 3 days per title)
  let provMap = load('prov', {});
  let provDirty = 0;
  function saveProv() {
    clearTimeout(provDirty);
    provDirty = setTimeout(() => {
      const e = Object.entries(provMap);
      if (e.length > 700) provMap = Object.fromEntries(e.sort((a, b) => b[1].t - a[1].t).slice(0, 500));
      save('prov', provMap);
    }, 400);
  }
  function parseProviders(us, ids) {
    const svcs = new Set(), others = new Set();
    ['flatrate', 'free', 'ads'].forEach(k => (us?.[k] || []).forEach(p => {
      const s = svcOfProvider(p.provider_id, ids);
      if (s) svcs.add(s); else others.add(p.provider_name);
    }));
    return { s: [...svcs], o: [...others].slice(0, 4), link: us?.link || '' };
  }
  async function servicesOf(it) {
    const k = ikey(it), c = provMap[k];
    if (c && Date.now() - c.t < 3 * DAY) return c;
    const ids = await providerIds();
    const d = await tmdb(`/${it.type}/${it.id}/watch/providers`, {}, { persist: false });
    const v = { t: Date.now(), ...parseProviders(d.results?.[REGION], ids) };
    provMap[k] = v; saveProv();
    return v;
  }
  // Look up many titles, a few at a time
  async function lookupAll(items, onEach) {
    let i = 0;
    const worker = async () => { while (i < items.length) { const it = items[i++]; try { onEach(it, await servicesOf(it)); } catch { onEach(it, null); } } };
    await Promise.all([1, 2, 3, 4, 5].map(worker));
  }

  // Discover titles on one service
  const daysAgo = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
  async function discover(svcId, type, { sort = 'popular', genre = '', page = 1 } = {}) {
    const ids = await providerIds();
    const p = { watch_region: REGION, with_watch_providers: ids[svcId].join('|'),
                with_watch_monetization_types: 'flatrate|free|ads', include_adult: 'false', page };
    if (genre) p.with_genres = genre;
    const date = type === 'movie' ? 'primary_release_date' : 'first_air_date';
    if (sort === 'popular') { p.sort_by = 'popularity.desc'; p['vote_count.gte'] = 10; }
    if (sort === 'top') { p.sort_by = 'vote_average.desc'; p['vote_count.gte'] = type === 'movie' ? 500 : 200; }
    if (sort === 'new') { p.sort_by = 'popularity.desc'; p[date + '.gte'] = daysAgo(150); p[date + '.lte'] = daysAgo(0); }
    const d = await tmdb('/discover/' + type, p, { trim: d => trimList({ ...d, results: (d.results || []).map(r => ({ ...r, media_type: type })) }) });
    d.results.forEach(it => mark(it, svcId));
    return d;
  }
  // Remember that discover found a title on a service (cheap partial answer until a full lookup)
  const seenOn = {};   // ikey -> Set of services seen through discover
  function mark(it, svcId) { (seenOn[ikey(it)] ||= new Set()).add(svcId); }
  const svcsKnown = it => { const c = provMap[ikey(it)]; return c ? c.s : seenOn[ikey(it)] ? [...seenOn[ikey(it)]] : null; };

  // Merge discover pages from several services, most popular first
  async function discoverMany(svcIds, type, opts) {
    const all = await Promise.all(svcIds.map(s => discover(s, type, opts).catch(e => ({ err: e, results: [], total: 0 }))));
    const err = all.find(a => a.err);
    if (err && all.every(a => a.err)) throw err.err;
    const byKey = new Map();
    all.forEach(a => a.results.forEach(it => { if (!byKey.has(ikey(it))) byKey.set(ikey(it), it); }));
    let list = [...byKey.values()];
    if (opts?.sort === 'top') list.sort((a, b) => b.vote - a.vote); else list.sort((a, b) => b.pop - a.pop);
    return { results: list, total: Math.max(...all.map(a => a.total || 0)) };
  }

  /* ---------- Likes (♥) ---------- */
  let likes = load('likes', []);   // newest first: { id, type, title, year, poster, at }
  const isLiked = it => likes.some(l => l.id === it.id && l.type === it.type);
  function toggleLike(it) {
    if (isLiked(it)) likes = likes.filter(l => !(l.id === it.id && l.type === it.type));
    else likes.unshift({ id: it.id, type: it.type, title: it.title, year: it.year, poster: it.poster, at: Date.now() });
    save('likes', likes); forYouStale = true; likedCount();
    return isLiked(it);
  }
  function likedCount() { const c = $('#liked-count'); c.textContent = likes.length; c.hidden = !likes.length; }

  /* ---------- Cards ---------- */
  const HEART = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.5S3.5 15.3 3.5 9.3A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8.5 2.3c0 6-8.5 11.2-8.5 11.2z"/></svg>';
  const HEART_O = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" aria-hidden="true"><path d="M12 20.5S3.5 15.3 3.5 9.3A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8.5 2.3c0 6-8.5 11.2-8.5 11.2z"/></svg>';
  const img = (path, w) => path && PH.store.get('posters') ? `<img src="https://image.tmdb.org/t/p/${w}${esc(path)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  function card(it, svcFilter) {
    known.set(ikey(it), it);
    const s = svcsKnown(it), mine = s && s.filter(x => PH.store.get('svc_' + x));
    const off = s && !mine.length && provMap[ikey(it)];
    return `<button class="card${off ? ' off' : ''}" data-open="${ikey(it)}" aria-label="${esc(it.title)}">
      <div class="poster"><span class="ph">${esc(it.title)}</span>${img(it.poster, 'w185')}${isLiked(it) ? `<span class="heart">${HEART}</span>` : ''}</div>
      <div class="t">${esc(it.title)}${it.year ? ` <span class="t-dim">${it.year}</span>` : ''}</div>
      <div class="tags">${mine ? tagHtml(mine) : ''}${off ? '<span class="tag s-none">Not yours</span>' : ''}</div></button>`;
  }
  // After a lookup, refresh that title's tags wherever its card is showing
  function retag(it, v) {
    document.querySelectorAll(`[data-open="${ikey(it)}"]`).forEach(c => {
      const mine = (v?.s || []).filter(x => PH.store.get('svc_' + x));
      c.classList.toggle('off', !!v && !mine.length);
      c.querySelector('.tags').innerHTML = v ? (mine.length ? tagHtml(mine) : '<span class="tag s-none">Not yours</span>') : '';
    });
  }
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-open]');
    if (c) PH.go('/title/' + c.dataset.open);
  });

  function segButtons(el, setting, withAll) {
    const opts = (withAll ? [{ id: 'all', short: 'All' }] : []).concat(active());
    let cur = PH.store.get(setting);
    if (!opts.some(o => o.id === cur)) cur = opts[0]?.id || 'all';
    el.innerHTML = opts.map(o => `<button type="button" role="radio" aria-checked="${o.id === cur}" data-v="${o.id}">${o.short}</button>`).join('');
    el.onclick = e => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      PH.store.set(setting, b.dataset.v);
      el.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', x === b));
      el.dispatchEvent(new Event('change'));
    };
    return cur;
  }
  const svcList = sel => sel === 'all' ? active().map(s => s.id) : [sel];
  const status = (el, msg, err) => { el.textContent = msg || ''; el.hidden = !msg; el.classList.toggle('err', !!err); };

  /* ---------- Home ---------- */
  let forYouStale = true, homeToken = 0;
  function renderHome() {
    const ready = !!apiKey;
    $('#home-setup').hidden = ready; $('#home-main').hidden = !ready;
    if (!ready) return;
    if (!active().length) {
      $('#home-svc').innerHTML = '';
      $('#home-rows').innerHTML = '<p class="status">No services switched on. Pick yours in Settings › My services.</p>';
      return;
    }
    const sel = segButtons($('#home-svc'), 'homeSvc', active().length > 1);
    const svcs = svcList(sel), token = ++homeToken;
    const rows = [
      likes.length && { id: 'foryou', title: 'For you', hint: 'from your ♥', load: () => forYou(svcs) },
      { id: 'tv', title: 'Popular shows', load: () => discoverMany(svcs, 'tv', { sort: 'popular' }) },
      { id: 'movie', title: 'Popular films', load: () => discoverMany(svcs, 'movie', { sort: 'popular' }) },
      { id: 'new', title: 'New this season', load: async () => {
        const [a, b] = await Promise.all([discoverMany(svcs, 'tv', { sort: 'new' }), discoverMany(svcs, 'movie', { sort: 'new' })]);
        return { results: [...a.results, ...b.results].sort((x, y) => y.pop - x.pop) };
      } },
      { id: 'top', title: 'Top rated films', load: () => discoverMany(svcs, 'movie', { sort: 'top' }) },
    ].filter(Boolean);
    if (!likes.length) rows.splice(2, 0, { id: 'hint', title: 'For you', text: 'Tap ♥ on titles you like and picks show up here.' });
    $('#home-rows').innerHTML = rows.map(r => `<section class="shelf" id="row-${r.id}"><div class="shelf-h"><h2>${r.title}</h2>${r.hint ? `<span class="hint">${r.hint}</span>` : ''}</div>
      <div class="strip">${r.text ? '' : '<p class="strip-empty">Loading…</p>'}</div>${r.text ? `<p class="strip-empty">${r.text}</p>` : ''}</section>`).join('');
    rows.filter(r => r.load).forEach(async r => {
      const strip = document.querySelector(`#row-${r.id} .strip`);
      try {
        const d = await r.load();
        if (token !== homeToken) return;
        const list = d.results.slice(0, 20);
        strip.innerHTML = list.length ? list.map(it => card(it)).join('') : `<p class="strip-empty">${r.id === 'foryou' ? 'No picks on your services yet. ♥ a few more titles.' : 'Nothing here right now.'}</p>`;
      } catch (e) {
        if (token !== homeToken) return;
        strip.innerHTML = `<p class="strip-empty" style="color:var(--amber)">${esc(e.message)}</p>`;
      }
    });
  }

  // "For you": TMDB recommendations for recent ♥ titles, scored by how often and how high they come up,
  // then kept only if they're on the chosen services.
  let forYouCache = null;
  async function forYou(svcs) {
    const sig = svcs.join(',');
    if (!forYouStale && forYouCache?.sig === sig) return forYouCache.d;
    const seeds = likes.slice(0, 10);
    const lists = await Promise.all(seeds.map(l => tmdb(`/${l.type}/${l.id}/recommendations`, {}, { ttl: 2 * DAY,
      trim: d => trimList({ ...d, results: (d.results || []).map(r => ({ ...r, media_type: r.media_type || l.type })) }) }).catch(() => ({ results: [] }))));
    const score = new Map();
    lists.forEach(l => l.results.forEach((it, i) => {
      if (isLiked(it)) return;
      const k = ikey(it), cur = score.get(k) || { it, s: 0 };
      cur.s += 1 + (20 - i) / 20; score.set(k, cur);
    }));
    const cands = [...score.values()].sort((a, b) => b.s - a.s || b.it.pop - a.it.pop).slice(0, 45).map(x => x.it);
    const keep = new Set();
    await lookupAll(cands, (it, v) => { if (v && v.s.some(s => svcs.includes(s))) keep.add(ikey(it)); });
    const d = { results: cands.filter(it => keep.has(ikey(it))) };
    forYouCache = { sig, d }; forYouStale = false;
    return d;
  }

  /* ---------- Browse ---------- */
  let brPage = 1, brTotal = 1, brToken = 0;
  async function genres(type) {
    const d = await tmdb('/genre/' + type + '/list', {}, { ttl: 30 * DAY, trim: d => d.genres || [] });
    return d;
  }
  async function renderBrowseFilters() {
    segButtons($('#br-svc'), 'brSvc', active().length > 1);
    $('#br-type').value = PH.store.get('brType');
    $('#br-sort').value = PH.store.get('brSort');
    try {
      const g = await genres(PH.store.get('brType'));
      $('#br-genre').innerHTML = '<option value="">All genres</option>' + g.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
      $('#br-genre').value = PH.store.get('brGenre');
      if ($('#br-genre').value !== String(PH.store.get('brGenre'))) PH.store.set('brGenre', '');
    } catch {}
  }
  async function loadBrowse(reset) {
    if (!apiKey) { $('#br-grid').innerHTML = ''; status($('#br-status'), 'Add your TMDB key in Settings first.', true); return; }
    if (!active().length) { $('#br-grid').innerHTML = ''; status($('#br-status'), 'No services switched on.', true); return; }
    if (reset) { brPage = 1; $('#br-grid').innerHTML = ''; }
    const token = ++brToken;
    status($('#br-status'), 'Loading…'); $('#br-more').hidden = true;
    try {
      const d = await discoverMany(svcList(PH.store.get('brSvc')), PH.store.get('brType'),
        { sort: PH.store.get('brSort'), genre: PH.store.get('brGenre'), page: brPage });
      if (token !== brToken) return;
      brTotal = d.total;
      const have = new Set([...document.querySelectorAll('#br-grid [data-open]')].map(c => c.dataset.open));
      $('#br-grid').insertAdjacentHTML('beforeend', d.results.filter(it => !have.has(ikey(it))).map(it => card(it)).join(''));
      status($('#br-status'), $('#br-grid').children.length ? '' : 'Nothing matches.');
      $('#br-more').hidden = brPage >= Math.min(brTotal, 20);
    } catch (e) { if (token === brToken) status($('#br-status'), e.message, true); }
  }
  $('#br-svc').addEventListener('change', () => loadBrowse(true));
  $('#br-type').onchange = async e => { PH.store.set('brType', e.target.value); PH.store.set('brGenre', ''); await renderBrowseFilters(); loadBrowse(true); };
  $('#br-genre').onchange = e => { PH.store.set('brGenre', e.target.value); loadBrowse(true); };
  $('#br-sort').onchange = e => { PH.store.set('brSort', e.target.value); loadBrowse(true); };
  $('#br-more').onclick = () => { brPage++; loadBrowse(false); };

  /* ---------- Search ---------- */
  let qTimer = 0, qToken = 0, lastQ = '';
  async function runSearch() {
    const q = $('#q').value.trim();
    if (q === lastQ) return; lastQ = q;
    const token = ++qToken;
    if (!q) { $('#q-grid').innerHTML = ''; status($('#q-status'), ''); return; }
    if (!apiKey) { status($('#q-status'), 'Add your TMDB key in Settings first.', true); return; }
    status($('#q-status'), 'Searching…');
    try {
      const d = await tmdb('/search/multi', { query: q, include_adult: 'false' }, { persist: false, trim: trimList });
      if (token !== qToken) return;
      const list = d.results.filter(it => it.type === 'movie' || it.type === 'tv').slice(0, 24);
      $('#q-grid').innerHTML = list.map(it => card(it)).join('');
      status($('#q-status'), list.length ? '' : 'No matches.');
      lookupAll(list, retag);
    } catch (e) { if (token === qToken) status($('#q-status'), e.message, true); }
  }
  $('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(runSearch, 450); });
  $('#q-form').onsubmit = e => { e.preventDefault(); clearTimeout(qTimer); runSearch(); $('#q').blur(); };

  /* ---------- My list ---------- */
  function renderLiked() {
    $('#liked-grid').innerHTML = likes.map(l => card(l)).join('');
    $('#liked-empty').hidden = !!likes.length;
  }

  /* ---------- Title page ---------- */
  let openItem = null, ttToken = 0;
  function likeKey() {
    const k = $('#k-like'), on = !!openItem && isLiked(openItem);
    k.innerHTML = on ? HEART : HEART_O;
    k.setAttribute('aria-pressed', on); k.setAttribute('aria-label', on ? 'Remove from my list' : 'Add to my list');
    k.style.color = on ? 'var(--ink-red)' : '';
    const b = $('#tt-like');
    if (b) { b.setAttribute('aria-pressed', on); b.innerHTML = (on ? HEART : HEART_O).replace('<svg', '<svg class="ico"') + (on ? ' On my list' : ' Add to my list'); }
  }
  function like() {
    if (!openItem) return;
    const on = toggleLike(openItem);
    likeKey(); PH.toast(on ? 'Added to my list.' : 'Removed from my list.');
  }
  $('#k-like').onclick = like;

  async function renderTitle() {
    const m = /^#\/title\/(movie|tv)-(\d+)/.exec(location.hash);
    const box = $('#tt');
    if (!m) { box.innerHTML = '<p class="status">Pick a title first.</p>'; openItem = null; likeKey(); return; }
    const type = m[1], id = +m[2], token = ++ttToken;
    const base = known.get(type + '-' + id) || likes.find(l => l.id === id && l.type === type) || { id, type, title: '', year: '', poster: '' };
    openItem = { ...base };
    box.innerHTML = titleHtml(openItem, null);
    likeKey();
    $('.screen-body').scrollTop = 0;
    if (!apiKey) return;
    try {
      const [d, ids] = await Promise.all([
        tmdb(`/${type}/${id}`, { append_to_response: 'watch/providers,recommendations' }, { ttl: DAY, trim: d => ({
          ...norm(d, type), overview: d.overview || '', runtime: d.runtime || (d.episode_run_time || [])[0] || 0,
          seasons: d.number_of_seasons || 0, genres: (d.genres || []).map(g => g.name).slice(0, 3),
          rating: d.vote_average || 0, prov: d['watch/providers']?.results?.[REGION] || null,
          recs: trimList({ results: (d.recommendations?.results || []).map(r => ({ ...r, media_type: r.media_type || type })) }).results.slice(0, 16) }) }),
        providerIds()]);
      if (token !== ttToken) return;
      const v = { t: Date.now(), ...parseProviders(d.prov, ids) };
      provMap[ikey(d)] = v; saveProv();
      openItem = { id: d.id, type: d.type, title: d.title, year: d.year, poster: d.poster };
      box.innerHTML = titleHtml(d, v);
      likeKey();
      lookupAll(d.recs, retag);
    } catch (e) {
      if (token === ttToken) box.insertAdjacentHTML('beforeend', `<p class="status err">${esc(e.message)}</p>`);
    }
  }
  function titleHtml(d, v) {
    const facts = [d.year, d.type === 'tv' ? 'Show' : 'Film',
      d.type === 'tv' ? (d.seasons ? d.seasons + (d.seasons > 1 ? ' seasons' : ' season') : '') : (d.runtime ? Math.floor(d.runtime / 60) + 'h ' + d.runtime % 60 + 'm' : ''),
      d.rating ? '★ ' + d.rating.toFixed(1) : ''].filter(Boolean).join(' · ');
    const mine = v ? v.s.filter(x => PH.store.get('svc_' + x)) : [];
    let watch = '';
    if (v) {
      watch = mine.map(s => `<a class="btn btn-block${s === mine[0] ? ' btn-primary' : ''}" href="${esc(SVC[s].open(d.title))}" target="_blank" rel="noopener">Watch on ${SVC[s].name}</a>`).join('');
      if (!mine.length) watch = `<p class="status err" style="margin:0">Not on your services right now.${v.o.length ? ' On ' + esc(v.o.join(', ')) + '.' : ''}</p>`;
      if (v.link) watch += `<a class="btn btn-ghost btn-block" href="${esc(v.link)}" target="_blank" rel="noopener">All ways to watch</a>`;
    } else watch = '<p class="status" style="margin:0">Checking your services…</p>';
    const recs = d.recs || [];
    return `<div class="ttl"><div class="poster"><span class="ph">${esc(d.title)}</span>${img(d.poster, 'w342')}</div>
        <div><h1>${esc(d.title) || '…'}</h1><div class="facts">${esc(facts)}${d.genres?.length ? '<br>' + esc(d.genres.join(', ')) : ''}</div></div></div>
      ${d.overview ? `<p class="overview">${esc(d.overview)}</p>` : ''}
      <div class="watch">${watch}<button class="btn btn-block like-btn" id="tt-like" aria-pressed="false" type="button"></button></div>
      ${recs.length ? `<section class="shelf"><div class="shelf-h"><h2>More like this</h2></div><div class="strip">${recs.map(it => card(it)).join('')}</div></section>` : ''}`;
  }
  document.addEventListener('click', e => { if (e.target.closest('#tt-like')) like(); });

  /* ---------- Settings ---------- */
  function renderSettings() {
    $('#key-state').textContent = apiKey ? 'Set ··' + apiKey.slice(-4) : 'Not set';
    $('#svc-state').textContent = active().map(s => s.short).join(', ') || 'None';
  }
  $('#key-save').onclick = async () => {
    const k = $('#key-in').value.trim();
    if (!k) { $('#key-in').setAttribute('aria-invalid', 'true'); $('#key-hint').textContent = 'Paste the key first.'; return; }
    const old = apiKey; apiKey = k; $('#key-save').disabled = true; $('#key-hint').textContent = 'Testing…';
    try {
      await tmdb('/configuration', {}, { persist: false, ttl: 0 });
      save('key', k); clearCache(); provIds = null; forYouStale = true;
      $('#key-in').value = ''; $('#key-in').removeAttribute('aria-invalid'); $('#key-hint').textContent = 'Saved on this phone only.';
      PH.toast('Key works. Loading listings.'); PH.go('/');
    } catch (e) {
      apiKey = old; $('#key-in').setAttribute('aria-invalid', 'true'); $('#key-hint').textContent = e.message;
    } finally { $('#key-save').disabled = false; }
  };
  $('#key-form').onsubmit = e => { e.preventDefault(); $('#key-save').click(); };
  ['svc_hulu', 'svc_prime', 'svc_peacock'].forEach(k => PH.on(k, () => { forYouStale = true; renderSettings(); }));
  PH.on('posters', () => { forYouStale = true; });
  $('#export').onclick = () => PH.exportFile('what-to-watch-list.json', JSON.stringify({ app: 'what-to-watch', version: 1, likes }, null, 2));
  $('#clear-cache').onclick = () => { clearCache(); provIds = null; forYouStale = true; PH.toast('Listings will refresh.'); };
  $('#erase').onclick = async () => {
    if (await PH.confirm('Erase your key, your list and saved listings? This can\'t be undone.', { title: 'Erase data', ok: 'Erase', danger: true })) {
      clearCache(); likes = []; apiKey = ''; provIds = null;
      ['key', 'likes', 'prov'].forEach(k => localStorage.removeItem(KEY + k));
      PH.store.reset(); likedCount(); renderSettings(); PH.toast('All data erased.', 'warn');
    }
  };

  /* ---------- Routing ---------- */
  function onRoute(r) {
    if (r === '/') renderHome();
    else if (r === '/browse') { renderBrowseFilters().then(() => { if (!$('#br-grid').children.length) loadBrowse(true); }); }
    else if (r === '/search') { if (!$('#q').value) setTimeout(() => $('#q').focus(), 50); }
    else if (r === '/liked') renderLiked();
    else if (r === '/title') renderTitle();
    else if (r.startsWith('/settings')) { renderSettings(); }
  }
  let lastRoute = null;
  PH.on('route', r => {
    // Coming back to Home or Browse keeps the page as it was unless something changed
    if (r === '/' && lastRoute && lastRoute !== '/' && !forYouStale && $('#home-rows').children.length && homeSig === sig()) { lastRoute = r; return; }
    if (r === '/') homeSig = sig();
    lastRoute = r; onRoute(r);
  });
  let homeSig = '';
  const sig = () => [apiKey, PH.store.get('homeSvc'), PH.store.get('posters'), active().map(s => s.id).join()].join('|');
  $('#home-svc').addEventListener('change', () => { homeSig = sig(); renderHome(); });
  ['svc_hulu', 'svc_prime', 'svc_peacock', 'posters'].forEach(k => PH.on(k, () => { $('#br-grid').innerHTML = ''; }));

  likedCount(); renderSettings(); homeSig = sig();
  onRoute((location.hash.replace(/^#/, '') || '/').startsWith('/title') ? '/title' : (document.querySelector('.view.is-active')?.dataset.route || '/'));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
