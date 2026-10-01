/* dc-lite: minimal runtime that renders the site's page templates with React.
   Each page ships two variants (desktop + mobile) in <script type="text/x-dc-page"> tags;
   the variant matching the viewport is mounted, and swapped when the viewport crosses the breakpoint. */
(function () {
  'use strict';
  var R = window.React, RD = window.ReactDOM, h = R.createElement;
  var BREAK = 1024, DESIGN_MIN = 1280;

  function DCLogic(props) { R.Component.call(this, props); this.state = {}; }
  DCLogic.prototype = Object.create(R.Component.prototype);
  DCLogic.prototype.constructor = DCLogic;
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/;

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return parseFloat(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.'), v;
    for (var s = scope; s; s = s.__parent) {
      if (Object.prototype.hasOwnProperty.call(s, parts[0])) { v = s[parts[0]]; break; }
    }
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  function str(v) { return v == null || v === false ? '' : String(v); }
  function interp(text, scope) { return text.replace(HOLE, function (_, p) { return str(lookup(p, scope)); }); }

  var RENAME = {
    'class': 'className', 'for': 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
    minlength: 'minLength', autocomplete: 'autoComplete', inputmode: 'inputMode', colspan: 'colSpan', rowspan: 'rowSpan',
    crossorigin: 'crossOrigin', srcset: 'srcSet', enctype: 'encType', referrerpolicy: 'referrerPolicy',
    contenteditable: 'contentEditable', spellcheck: 'spellCheck', datetime: 'dateTime', novalidate: 'noValidate',
    autofocus: 'autoFocus', playsinline: 'playsInline', allowfullscreen: 'allowFullScreen', enterkeyhint: 'enterKeyHint',
    'accept-charset': 'acceptCharset', 'http-equiv': 'httpEquiv', frameborder: 'frameBorder', 'xlink:href': 'href'
  };
  var BOOL = { allowfullscreen: 1, async: 1, autofocus: 1, autoplay: 1, checked: 1, controls: 1, default: 1, defer: 1,
    disabled: 1, formnovalidate: 1, hidden: 1, loop: 1, multiple: 1, muted: 1, novalidate: 1, open: 1,
    playsinline: 1, readonly: 1, required: 1, reversed: 1, selected: 1 };

  function parseStyle(s) {
    var out = {}, decls = [], depth = 0, q = null, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ';' && depth === 0) { decls.push(cur); cur = ''; continue; }
      cur += c;
    }
    decls.push(cur);
    decls.forEach(function (d) {
      var k = d.indexOf(':'); if (k < 0) return;
      var name = d.slice(0, k).trim(), val = d.slice(k + 1).trim();
      if (!name) return;
      var imp = /\s*!important\s*$/i.test(val);
      if (imp) val = val.replace(/\s*!important\s*$/i, '');
      if (name.indexOf('--') !== 0) name = name.toLowerCase().replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, function (_, l) { return l.toUpperCase(); });
      out[name] = val;
    });
    return out;
  }

  /* compile a DOM node into a render function (scope) -> React node(s) */
  function compile(node) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      if (t.indexOf('{{') < 0) return function () { return t; };
      return function (scope) {
        var parts = [], last = 0, m; HOLE.lastIndex = 0;
        while ((m = HOLE.exec(t))) { parts.push(t.slice(last, m.index)); parts.push(str(lookup(m[1], scope))); last = HOLE.lastIndex; }
        parts.push(t.slice(last));
        return parts.join('');
      };
    }
    if (node.nodeType !== 1) return null;
    var tag = node.tagName.toLowerCase();
    if (tag === 'helmet') return null;
    var kids = compileChildren(node);
    if (tag === 'sc-if') {
      var cond = node.getAttribute('value') || '';
      return function (scope) {
        var m = WHOLE.exec(cond), v = m ? lookup(m[1], scope) : cond;
        if (Array.isArray(v) ? !v.length : !v) return null;
        return h.apply(null, [R.Fragment, null].concat(kids(scope)));
      };
    }
    if (tag === 'sc-for') {
      var listSrc = node.getAttribute('list') || '', as = node.getAttribute('as') || 'item';
      return function (scope) {
        var m = WHOLE.exec(listSrc), list = m ? lookup(m[1], scope) : null;
        if (!list || !list.length) return null;
        return list.map(function (item, i) {
          var s = { __parent: scope, $index: i }; s[as] = item;
          return h.apply(null, [R.Fragment, { key: (item && item.key != null) ? item.key : i }].concat(kids(s)));
        });
      };
    }
    var isSvg = node.namespaceURI === 'http://www.w3.org/2000/svg';
    var attrs = [];
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], name = a.name, val = a.value;
      if (name.indexOf('hint-') === 0) continue;
      attrs.push([name, val]);
    }
    var hasHandler = attrs.some(function (a) { return a[0] === 'onInput' || a[0] === 'onChange' || /^on(input|change)$/i.test(a[0]); });
    var textareaText = tag === 'textarea' ? node.textContent : null;
    if (tag === 'textarea') kids = function () { return []; };
    return function (scope) {
      var props = {};
      attrs.forEach(function (a) {
        var name = a[0], raw = a[1], v;
        var m = WHOLE.exec(raw);
        if (m) v = lookup(m[1], scope);
        else if (raw.indexOf('{{') >= 0) v = interp(raw, scope);
        else v = raw;
        var lname = name.toLowerCase();
        if (/^on[A-Z]/.test(name) || /^on[a-z]+$/.test(name) && typeof v === 'function') {
          if (typeof v !== 'function') return;
          if (/^on[a-z]+$/.test(name)) name = 'on' + name.charAt(2).toUpperCase() + name.slice(3);
          props[name] = v; return;
        }
        if (lname === 'style') { props.style = typeof v === 'string' ? parseStyle(v) : v; return; }
        if (BOOL[lname] && !isSvg) {
          if (v === '' || v === lname || v === true) v = true;
          else if (v === false || v == null || v === 'false') v = false;
        }
        if (v == null) return;
        if (!isSvg || lname === 'class') name = RENAME[lname] || name;
        if ((tag === 'input' || tag === 'select') && !hasHandler) {
          if (name === 'value') name = 'defaultValue';
          if (name === 'checked') name = 'defaultChecked';
        }
        props[name] = v;
      });
      if (textareaText) props.defaultValue = textareaText;
      return h.apply(null, [tag, props].concat(kids(scope)));
    };
  }
  function compileChildren(node) {
    var fns = [];
    for (var c = node.firstChild; c; c = c.nextSibling) { var f = compile(c); if (f) fns.push(f); }
    return function (scope) {
      var out = [];
      for (var i = 0; i < fns.length; i++) out.push(fns[i](scope));
      return out;
    };
  }

  function buildVariant(srcEl) {
    var src = JSON.parse(srcEl.textContent);
    var doc = new DOMParser().parseFromString('<!doctype html><html><head></head><body>' + src.template + '</body></html>', 'text/html');
    var styles = [];
    doc.querySelectorAll('helmet').forEach(function (hel) {
      Array.prototype.forEach.call(hel.children, function (c) { styles.push(c.outerHTML); });
    });
    var render = compileChildren(doc.body);
    var Logic = new Function('DCLogic', 'React', src.js + '\n;return Component;')(DCLogic, R);
    var Tpl = function (props) { return h.apply(null, [R.Fragment, null].concat(render(props.vals))); };
    var origRender = Logic.prototype.render;
    Logic.prototype.render = function () {
      var vals = this.renderVals ? this.renderVals() : {};
      return h(Tpl, { vals: vals || {} });
    };
    return { Logic: Logic, styles: styles, name: srcEl.getAttribute('data-variant') };
  }

  var variants = {}, root = null, current = null, styleNodes = [];
  function mount(which) {
    if (which === current) return;
    var el = document.querySelector('script[data-variant="' + which + '"]');
    if (!el) return;
    if (!variants[which]) variants[which] = buildVariant(el);
    var v = variants[which];
    styleNodes.forEach(function (n) { n.remove(); });
    styleNodes = [];
    var tmp = document.createElement('div');
    tmp.innerHTML = v.styles.join('');
    Array.prototype.slice.call(tmp.childNodes).forEach(function (n) { document.head.appendChild(n); styleNodes.push(n); });
    var container = document.getElementById('dc-root');
    if (root) root.unmount();
    container.innerHTML = '';
    root = RD.createRoot(container);
    root.render(h(v.Logic, {}));
    current = which;
    document.documentElement.setAttribute('data-variant', which);
    // honour #hash on first load
    if (location.hash && !mount._scrolled) {
      mount._scrolled = true;
      setTimeout(function () { var t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }, 60);
    }
  }
  var mq = window.matchMedia('(max-width: ' + (BREAK - 1) + 'px)');
  function fit() {
    // the desktop design is laid out for >= 1280px; on narrower screens scale it down instead of scrolling sideways
    var z = current === 'desktop' && window.innerWidth < DESIGN_MIN ? window.innerWidth / DESIGN_MIN : '';
    document.documentElement.style.zoom = z ? String(z) : '';
  }
  function pick() { mount(mq.matches ? 'mobile' : 'desktop'); fit(); }
  window.addEventListener('resize', fit);
  if (mq.addEventListener) mq.addEventListener('change', pick); else mq.addListener(pick);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pick); else pick();
})();
