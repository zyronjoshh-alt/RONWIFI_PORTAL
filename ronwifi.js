/* ==============================================================
   RONwifi Portal Logic
   ES5 compatible (Samsung J2, old Android TVs)
   ============================================================== */

(function() {
  'use strict';

  /* ---------- STATE ---------- */
  var state = {
    mac: '',
    macNoColons: '',
    ip: '',
    interface: '',
    linkLoginOnly: '',
    linkOrig: '',
    vendo: null,
    session: null,      // { session_id, pesos, minutes, expires_at_ms }
    coinModalOpen: false,
    coinTimerId: null,
    coinTimeoutAt: 0
  };

  /* ---------- SETTINGS (from settings.js) ---------- */
  var SETTINGS = window.RONWIFI_SETTINGS || {};

  /* ---------- DOM helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.style.display = ''; }
  function hide(el) { if (el) el.style.display = 'none'; }
  function showModal(id) { $(id).className = 'modal active'; }
  function hideModal(id) { $(id).className = 'modal'; }

  /* ---------- INIT ---------- */
  function init() {
    parseMikrotikVars();
    resolveVendo();
    applySettings();
    applyTheme();
    bindEvents();
    renderDeviceCard();
    refreshSession();
  }

  function parseMikrotikVars() {
    var v = window.MIKROTIK_VARS || {};
    
    // MikroTik substitutes variables with actual values, or leaves as "$(var)" in dev
    var mac = v.mac && v.mac.indexOf('$') !== 0 ? v.mac : '';
    var ip = v.ip && v.ip.indexOf('$') !== 0 ? v.ip : '';
    var iface = v.interface && v.interface.indexOf('$') !== 0 ? v.interface : '';
    
    // Fall back to URL params if MikroTik vars not present (dev/testing)
    if (!mac || !ip) {
      var params = parseQueryString();
      mac = mac || params.mac || '';
      ip = ip || params.ip || '';
      iface = iface || params.interface || '';
    }
    
    // Dev fallback: use a test MAC so UI works in browser
    if (!mac) {
      mac = 'AA:BB:CC:11:22:33';
      ip = '10.0.11.50';
      iface = 'vlan11';
    }
    
    state.mac = mac.toUpperCase();
    state.macNoColons = state.mac.replace(/[:-]/g, '');
    state.ip = ip;
    state.interface = iface;
    state.linkLoginOnly = v.link_login_only || '';
    state.linkOrig = v.link_orig || '';
  }

  function parseQueryString() {
    var q = window.location.search.substring(1);
    var pairs = q ? q.split('&') : [];
    var result = {};
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      result[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
    return result;
  }

  function resolveVendo() {
    var vendos = (SETTINGS.vendos) || [];
    for (var i = 0; i < vendos.length; i++) {
      if (vendos[i].interface === state.interface) {
        state.vendo = vendos[i];
        return;
      }
    }
    // Fallback: first enabled vendo
    if (vendos.length > 0) state.vendo = vendos[0];
  }

  function applySettings() {
    if (SETTINGS.brand) {
      $('brandTitle').textContent = SETTINGS.brand.title || 'RONwifi';
      $('footerBrand').textContent = SETTINGS.brand.title || 'RONwifi';
      if (SETTINGS.brand.announcement_enabled && SETTINGS.brand.announcement_text) {
        $('announcementText').textContent = SETTINGS.brand.announcement_text;
        show($('announcement'));
      }
    }
    
    var features = SETTINGS.features || {};
    if (features.voucher_enabled === false) hide($('voucherBtn'));
    if (features.points_enabled === false) hide($('pointsBtn'));
  }

  function renderDeviceCard() {
    $('macDisplay').textContent = state.mac || '—';
    $('ipDisplay').textContent = state.ip || '—';
    $('vendoDisplay').textContent = state.vendo ? state.vendo.name : '—';
    $('vendoName').textContent = state.vendo ? state.vendo.name : '—';
  }

  /* ---------- THEME ---------- */
  function applyTheme() {
    var saved = localStorage.getItem('ronwifi_theme');
    if (saved === 'dark') {
      document.body.className = 'theme-dark';
      $('themeIcon').innerHTML = '&#9728;'; // sun
    } else {
      document.body.className = 'theme-light';
      $('themeIcon').innerHTML = '&#9790;'; // moon
    }
  }

  function toggleTheme() {
    var isDark = document.body.className === 'theme-dark';
    localStorage.setItem('ronwifi_theme', isDark ? 'light' : 'dark');
    applyTheme();
  }

  /* ---------- EVENTS ---------- */
  function bindEvents() {
    $('themeBtn').onclick = toggleTheme;
    $('insertCoinBtn').onclick = onInsertCoin;
    $('voucherBtn').onclick = function() { showModal('voucherModal'); $('voucherInput').focus(); };
    $('pointsBtn').onclick = function() { $('pointsBalance').textContent = '0'; showModal('pointsModal'); };
    $('ratesBtn').onclick = onRatesClick;
    $('historyBtn').onclick = onHistoryClick;
    
    $('coinCancelBtn').onclick = onCoinCancel;
    $('coinDoneBtn').onclick = onCoinDone;
    
    $('errorCloseBtn').onclick = function() { hideModal('errorModal'); };
    $('errorRetryBtn').onclick = function() { hideModal('errorModal'); onInsertCoin(); };
    
    $('voucherCancelBtn').onclick = function() { hideModal('voucherModal'); };
    $('voucherRedeemBtn').onclick = onVoucherRedeem;
    
    $('pointsCloseBtn').onclick = function() { hideModal('pointsModal'); };
    $('ratesCloseBtn').onclick = function() { hideModal('ratesModal'); };
    $('historyCloseBtn').onclick = function() { hideModal('historyModal'); };
  }

/* ---------- INSERT COIN FLOW ---------- */
  function onInsertCoin() {
    if (!state.vendo) {
      toast('No vendo configured', 'error');
      return;
    }

    showModal('initModal');
    animateProgress($('initProgress'), 0, 95, 5000);

    // Try backend first, then fall back to ESP direct
    tryBackendCoinStart(function(err, backendResult) {
      if (!err && backendResult) {
        hideModal('initModal');
        enterCoinSession(backendResult);
        return;
      }
      
      // Backend failed/timed out — try ESP direct
      tryEspCoinStart(function(err, espResult) {
        hideModal('initModal');
        
        if (!err && espResult) {
          // Success or Resume!
          enterCoinSession(espResult);
        } else if (err && err.isHttpError) {
          // ESP gave us a specific rejection
          var code = (err.body && err.body.error) ? err.body.error.code : '';
          var msg = (err.body && err.body.error) ? err.body.error.message : 'Unknown error';
          
          if (code === 'banned') {
            $('bannedMessage').textContent = msg;
            showModal('bannedModal');
          } else if (code === 'busy') {
            showModal('busyModal');
          } else if (code === 'limbo') {
            toast(msg, 'warn');
          } else {
            showErrorModal('Error', msg);
          }
        } else {
          // Total failure (timeout, network drop)
          showErrorModal('Coinslot Unavailable', 'Could not reach the coinslot. Please notify the operator.');
        }
      });
    });
  }

  function tryEspCoinStart(cb) {
    if (!state.vendo || !state.vendo.ip) { cb(new Error('no ip')); return; }
    
    var url = 'http://' + state.vendo.ip + '/coin/start';
    httpPost(url, {
      mac: state.macNoColons,
      ip: state.ip
    }, 8000, function(err, resp) {
      if (err) { cb(err); return; }
      if (!resp || !resp.ok) { cb(new Error('not ok')); return; }
      cb(null, resp.data || {});
    });
  }
  
  // Note: I also quickly updated tryBackendCoinStart signature to match the (err, result) pattern
  function tryBackendCoinStart(cb) {
    if (!SETTINGS.backend || !SETTINGS.backend.base_url) {
      cb(new Error('no backend')); return;
    }
    var url = SETTINGS.backend.base_url + '/api/portal/coin/start';
    httpPost(url, {
      mac: state.macNoColons,
      ip: state.ip,
      vendo_id: state.vendo.id,
      interface: state.interface
    }, (SETTINGS.backend.timeout_ms || 5000), function(err, resp) {
      if (err || !resp || !resp.ok) { cb(err || new Error('not ok')); return; }
      cb(null, resp.data || {});
    });
  }

  function enterCoinSession(data) {
    state.session = {
      session_id: data.session_id || null,
      pesos: 0,
      minutes: 0
    };
    state.coinModalOpen = true;
    $('coinAmount').textContent = '0';
    $('coinTimeEstimate').textContent = '0 min';
    show($('coinCancelBtn'));
    showModal('coinModal');
    startCoinTimer();
    pollCoinStatus();
    
    // Telegram: session started (if enabled)
    sendTelegram('on_insert_coin', 'Session started at ' + state.vendo.name);
  }

  function startCoinTimer() {
    state.coinTimeoutAt = Date.now() + 60000;
    updateCoinTimerUI();
    if (state.coinTimerId) clearInterval(state.coinTimerId);
    state.coinTimerId = setInterval(function() {
      var remaining = Math.max(0, state.coinTimeoutAt - Date.now());
      if (remaining <= 0) {
        clearInterval(state.coinTimerId);
        onCoinTimeout();
        return;
      }
      updateCoinTimerUI();
    }, 500);
  }

  function resetCoinTimer() {
    state.coinTimeoutAt = Date.now() + 60000;
    updateCoinTimerUI();
  }

  function updateCoinTimerUI() {
    var remaining = Math.max(0, state.coinTimeoutAt - Date.now());
    var seconds = Math.ceil(remaining / 1000);
    $('coinTimerText').textContent = seconds;
    $('coinTimerFill').style.width = ((remaining / 60000) * 100) + '%';
  }

  function pollCoinStatus() {
    if (!state.coinModalOpen || !state.session) return;
    
    // Try ESP /status poll
    if (state.vendo && state.vendo.ip) {
      var url = 'http://' + state.vendo.ip + '/status/' + 
        (state.session.session_id || 'current');
      httpGet(url, 3000, function(err, resp) {
        if (resp && resp.ok && resp.data) {
          var prevPesos = state.session.pesos;
          state.session.pesos = resp.data.pesos || 0;
          state.session.minutes = resp.data.minutes || 0;
          $('coinAmount').textContent = state.session.pesos;
          $('coinTimeEstimate').textContent = formatMinutes(state.session.minutes);
          if (state.session.pesos > 0) {
            hide($('coinCancelBtn'));
          }
          if (state.session.pesos > prevPesos) {
            resetCoinTimer();
            sendTelegram('on_each_coin', 'Coin inserted: +₱' + 
              (state.session.pesos - prevPesos) + ' (total ₱' + state.session.pesos + ')');
          }
        }
        // Schedule next poll
        if (state.coinModalOpen) setTimeout(pollCoinStatus, 1000);
      });
    } else {
      setTimeout(pollCoinStatus, 1000);
    }
  }

  function onCoinDone() {
    finalizeCoinSession('done');
  }

  function onCoinCancel() {
    finalizeCoinSession('cancel');
  }

  function onCoinTimeout() {
    finalizeCoinSession('timeout');
  }

  function finalizeCoinSession(reason) {
    state.coinModalOpen = false;
    if (state.coinTimerId) { clearInterval(state.coinTimerId); state.coinTimerId = null; }
    hideModal('coinModal');
    
    if (reason === 'cancel') {
      var cancelUrl = 'http://' + vendoIp + '/coin/cancel';
      httpPost(cancelUrl, { session_id: state.session ? state.session.session_id : null }, 3000, function() {});
      state.session = null;
      return;
    }

    // Call /coin/done on ESP (or backend)
    var vendoIp = state.vendo && state.vendo.ip;
    if (!vendoIp) {
      toast('No vendo configured', 'error');
      return;
    }
    
    var url = 'http://' + vendoIp + '/coin/done';
    httpPost(url, {
      session_id: state.session ? state.session.session_id : null,
      mac: state.macNoColons,
      ip: state.ip
    }, 10000, function(err, resp) {
      if (err || !resp || !resp.ok) {
        toast('Error finalizing transaction', 'error');
        sendTelegram('on_done', 'Transaction FAILED at ' + state.vendo.name);
        state.session = null;
        return;
      }
      var d = resp.data || {};
      var minutes = d.minutes || 0;
      var pesos = d.pesos || 0;
      toast('₱' + pesos + ' → ' + formatMinutes(minutes) + ' granted!', 'success');
      sendTelegram('on_done', '✅ ₱' + pesos + ' → ' + formatMinutes(minutes) + 
        ' at ' + state.vendo.name);
      state.session = null;
      
      // Redirect to original destination after brief pause
      setTimeout(function() {
        if (state.linkOrig) {
          window.location.href = state.linkOrig;
        } else {
          refreshSession();
        }
      }, 2000);
    });
  }

  /* ---------- VOUCHER ---------- */
  function onVoucherRedeem() {
    var code = $('voucherInput').value.trim().toUpperCase();
    if (!code) {
      $('voucherMessage').textContent = 'Please enter a voucher code.';
      return;
    }
    // For v0: just show a toast. Backend integration later.
    $('voucherMessage').textContent = 'Voucher redemption requires backend connection.';
    setTimeout(function() {
      hideModal('voucherModal');
      $('voucherInput').value = '';
      $('voucherMessage').textContent = '';
    }, 2000);
  }

  /* ---------- RATES ---------- */
  function onRatesClick() {
    // v0: get rates from ESP
    if (!state.vendo || !state.vendo.ip) {
      $('ratesList').innerHTML = '<div class="history-empty">No vendo configured</div>';
      showModal('ratesModal');
      return;
    }
    
    $('ratesList').innerHTML = '<div class="history-empty">Loading...</div>';
    showModal('ratesModal');
    
    var url = 'http://' + state.vendo.ip + '/rates';
    httpGet(url, 3000, function(err, resp) {
      if (err || !resp || !resp.ok) {
        $('ratesList').innerHTML = '<div class="history-empty">Could not load rates</div>';
        return;
      }
      var tiers = (resp.data && resp.data.tiers) || [];
      if (!tiers.length) {
        $('ratesList').innerHTML = '<div class="history-empty">No rates configured</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < tiers.length; i++) {
        html += '<div class="rate-row">' +
          '<span class="rate-pesos">₱' + tiers[i].pesos + '</span>' +
          '<span class="rate-label">' + tiers[i].label + '</span>' +
          '<span class="rate-minutes">' + formatMinutes(tiers[i].minutes) + '</span>' +
          '</div>';
      }
      $('ratesList').innerHTML = html;
    });
  }

  /* ---------- HISTORY ---------- */
  function onHistoryClick() {
    // v0: placeholder
    $('historyList').innerHTML = '<div class="history-empty">History requires backend connection</div>';
    showModal('historyModal');
  }

  /* ---------- SESSION STATUS ---------- */
  function refreshSession() {
    // v0: check if there's already an active session by asking MikroTik via link_login_only
    // For now just show the Insert Coin UI
    hide($('sessionCard'));
  }

  /* ---------- TELEGRAM ---------- */
  function sendTelegram(eventType, message) {
    if (!SETTINGS.features || !SETTINGS.features.telegram_enabled) return;
    if (!SETTINGS.telegram || !SETTINGS.telegram.bot_token) return;
    
    var events = SETTINGS.telegram.events || {};
    if (events[eventType] === false) return;
    
    if (!state.vendo || !state.vendo.telegram_chat_id) return;
    
    var url = 'https://api.telegram.org/bot' + SETTINGS.telegram.bot_token + 
      '/sendMessage?chat_id=' + encodeURIComponent(state.vendo.telegram_chat_id) +
      '&text=' + encodeURIComponent(message);
    
    // Fire and forget
    var img = new Image();
    img.src = url;
  }

  /* ---------- HTTP UTILITIES ---------- */
  function httpPost(url, data, timeout, cb) {
    var xhr = new XMLHttpRequest();
    var aborted = false;
    var timer = setTimeout(function() {
      aborted = true;
      xhr.abort();
      cb(new Error('timeout'));
    }, timeout);
    
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        clearTimeout(timer);
        if (aborted) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try { cb(null, JSON.parse(xhr.responseText)); }
          catch (e) { cb(e); }
        } else {
          // NEW: Try to parse the error JSON from the ESP
          try { 
            var errResp = JSON.parse(xhr.responseText);
            cb({ isHttpError: true, status: xhr.status, body: errResp });
          } catch (e) { 
            cb(new Error('HTTP ' + xhr.status)); 
          }
        }
      }
    };
    try { xhr.send(JSON.stringify(data)); }
    catch (e) { clearTimeout(timer); cb(e); }
  }

  function httpGet(url, timeout, cb) {
    var xhr = new XMLHttpRequest();
    var aborted = false;
    var timer = setTimeout(function() {
      aborted = true;
      xhr.abort();
      cb(new Error('timeout'));
    }, timeout);
    
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        clearTimeout(timer);
        if (aborted) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try { cb(null, JSON.parse(xhr.responseText)); }
          catch (e) { cb(e); }
        } else {
          cb(new Error('HTTP ' + xhr.status));
        }
      }
    };
    try { xhr.send(); }
    catch (e) { clearTimeout(timer); cb(e); }
  }

  /* ---------- UI HELPERS ---------- */
  function showErrorModal(title, message) {
    $('errorTitle').textContent = title;
    $('errorMessage').textContent = message;
    showModal('errorModal');
  }

  function toast(message, kind) {
    var cls = 'toast toast-' + (kind || 'info');
    var t = document.createElement('div');
    t.className = cls;
    t.textContent = message;
    $('toastContainer').appendChild(t);
    setTimeout(function() {
      t.style.opacity = '0';
      setTimeout(function() {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 300);
    }, 3500);
  }

  function animateProgress(el, from, to, durationMs) {
    el.style.width = from + '%';
    el.style.transition = 'width ' + (durationMs / 1000) + 's ease-out';
    // Force reflow then apply target
    void el.offsetWidth;
    el.style.width = to + '%';
  }

  function formatMinutes(m) {
    if (!m) return '0 min';
    if (m < 60) return m + ' min';
    if (m < 1440) {
      var h = Math.floor(m / 60);
      var min = m % 60;
      return h + 'h' + (min ? ' ' + min + 'm' : '');
    }
    var d = Math.floor(m / 1440);
    var rem = m % 1440;
    var h2 = Math.floor(rem / 60);
    return d + 'd' + (h2 ? ' ' + h2 + 'h' : '');
  }

  /* ---------- BOOT ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
