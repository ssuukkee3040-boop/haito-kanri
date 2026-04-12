// ============================================================
// 高配当銘柄 購入シグナル通知bot【両学長・こびと株 完全準拠版】
// v3: Yahoo Finance US API全廃止対応 → Yahoo Finance Japan スクレイピング方式
// ============================================================

var TELEGRAM_TOKEN   = '8502192155:AAE_yJ_k6EEYH-U9-0xdXbbHC0lu-S96_oc';
var TELEGRAM_CHAT_ID = '8789739101';

var JP_MIN_YIELD      = 3.75;
var JP_MAX_YIELD      = 8.0;
var JP_MAX_PBR        = 1.5;
var JP_MAX_PAYOUT     = 0.70;
var JP_MIN_OP_MARGIN  = 0.03;
var JP_REQUIRE_POSITIVE_EPS = true;
var JP_GOOD_OP_MARGIN   = 0.10;
var JP_GOOD_EQUITY_RATIO = 0.50;
var JP_GOOD_ROE         = 0.08;
var JP_GOOD_PAYOUT      = 0.50;
var JP_MAX_FROM_LOW   = 20.0;
var JP_MIN_DROP       = 15.0;

var US_WATCHLIST = [
  { code: 'VYM',  minYield: 3.0 },
  { code: 'HDV',  minYield: 3.5 },
  { code: 'SPYD', minYield: 4.0 },
  { code: 'ARCC', minYield: 9.0 },
];

var RANKING_PAGES   = 5;
var CACHE_TTL_MIN   = 60;
var BATCH_SIZE      = 20;
var COOLDOWN_MINUTES = 360;

var JP_FALLBACK = [
  '8058','8031','8053','8001','8002',
  '9433','9432','9434',
  '8316','8411','8306','8309',
  '8725','8750','8766',
  '9501','9502','9503',
  '1605','5020',
  '9101','9104','9107',
  '8802','8801',
  '2914','2802','2503',
  '5401','5411',
  '4502','4503',
];

// ============================================================
// メイン処理
// ============================================================
function checkBuySignals() {
  var signals = [];

  var jpCandidates = getJPCandidates();
  var jpBatch = getNextBatch(jpCandidates);
  Logger.log('日本株チェック: ' + jpBatch.length + '銘柄 / 全' + jpCandidates.length + '銘柄');

  jpBatch.forEach(function(code) {
    try {
      var result = checkJapanStock(code);
      if (result) signals.push(result);
    } catch(e) {
      Logger.log('JP error [' + code + ']: ' + e.message);
    }
    Utilities.sleep(700);
  });

  US_WATCHLIST.forEach(function(item) {
    try {
      var result = checkUSStock(item.code, item.minYield);
      if (result) signals.push(result);
    } catch(e) {
      Logger.log('US error [' + item.code + ']: ' + e.message);
    }
    Utilities.sleep(300);
  });

  signals.forEach(function(sig) {
    if (!isCooledDown(sig.code)) return;
    sendSignalNotification(sig);
    setCooldown(sig.code);
  });

  Logger.log('完了 | バッチ:' + jpBatch.length + ' シグナル:' + signals.length);
}

// ============================================================
// 日本株スクリーニング
// ============================================================
function checkJapanStock(code) {
  var data = fetchJapanStockData(code);
  if (!data || !data.currentPrice || data.currentPrice <= 0) return null;

  var metConditions = [];
  var warnings      = [];

  if (!data.yieldPct || data.yieldPct <= 0) return null;
  if (data.yieldPct < JP_MIN_YIELD) return null;
  if (data.yieldPct > JP_MAX_YIELD) {
    Logger.log('[罠除外] ' + code + ' 利回り' + data.yieldPct.toFixed(1) + '%超');
    return null;
  }

  if (JP_REQUIRE_POSITIVE_EPS && data.trailingEps !== null && data.trailingEps !== undefined) {
    if (data.trailingEps <= 0) {
      Logger.log('[罠除外] ' + code + ' 赤字EPS=' + data.trailingEps);
      return null;
    }
  }

  if (data.payoutRatio > 0 && data.payoutRatio > JP_MAX_PAYOUT) {
    Logger.log('[罠除外] ' + code + ' 配当性向' + (data.payoutRatio * 100).toFixed(0) + '%超');
    return null;
  }

  if (data.operatingMargin !== null && data.operatingMargin !== undefined && data.operatingMargin !== 0) {
    if (data.operatingMargin < JP_MIN_OP_MARGIN) {
      Logger.log('[罠除外] ' + code + ' 営業利益率' + (data.operatingMargin * 100).toFixed(1) + '%未満');
      return null;
    }
  }

  metConditions.push('✅ 配当利回り ' + data.yieldPct.toFixed(2) + '% ≥ ' + JP_MIN_YIELD + '%');

  if (data.pbr > 0) {
    if (data.pbr <= JP_MAX_PBR) {
      metConditions.push('✅ PBR ' + data.pbr.toFixed(2) + '倍（≤ ' + JP_MAX_PBR + '倍）');
    } else {
      warnings.push('⚠️ PBR ' + data.pbr.toFixed(2) + '倍（目標 ≤ ' + JP_MAX_PBR + '倍）');
    }
  }

  if (data.payoutRatio > 0) {
    var payoutPct = (data.payoutRatio * 100).toFixed(0);
    if (data.payoutRatio <= JP_GOOD_PAYOUT) {
      metConditions.push('✅ 配当性向 ' + payoutPct + '%（余裕あり）');
    } else {
      warnings.push('⚠️ 配当性向 ' + payoutPct + '%（やや高め）');
    }
  }

  if (data.operatingMargin > 0) {
    var opPct = (data.operatingMargin * 100).toFixed(1);
    metConditions.push('✅ 営業利益率 ' + opPct + '%' + (data.operatingMargin >= JP_GOOD_OP_MARGIN ? '（優良）' : '（健全）'));
  }

  if (data.roe > 0 && data.roe >= JP_GOOD_ROE) {
    metConditions.push('✅ ROE ' + (data.roe * 100).toFixed(1) + '%（収益力あり）');
  }

  if (data.equityRatio > 0) {
    var erPct = (data.equityRatio * 100).toFixed(1);
    if (data.equityRatio >= JP_GOOD_EQUITY_RATIO) {
      metConditions.push('✅ 自己資本比率 ' + erPct + '%（財務健全）');
    } else if (data.equityRatio < 0.30) {
      warnings.push('⚠️ 自己資本比率 ' + erPct + '%（低め）');
    }
  }

  if (data.fiftyTwoWeekLow > 0) {
    var fromLow = (data.currentPrice - data.fiftyTwoWeekLow) / data.fiftyTwoWeekLow * 100;
    if (fromLow <= JP_MAX_FROM_LOW) {
      metConditions.push('✅ 52週安値から+' + fromLow.toFixed(1) + '%（割安圏）');
    }
  }
  if (data.fiftyTwoWeekHigh > 0) {
    var dropPct = (data.currentPrice - data.fiftyTwoWeekHigh) / data.fiftyTwoWeekHigh * 100;
    if (dropPct <= -JP_MIN_DROP) {
      metConditions.push('✅ 高値から' + Math.abs(dropPct).toFixed(1) + '%下落（利回り下昇中）');
    }
  }

  if (metConditions.length === 0) return null;

  return {
    code: code, market: 'japan',
    name: data.name || code,
    currentPrice: data.currentPrice,
    yieldPct: data.yieldPct,
    pbr: data.pbr || 0,
    metConditions: metConditions,
    warnings: warnings,
    change: data.change,
    changePct: data.changePct,
  };
}

// ============================================================
// 米国ETFスクリーニング
// ============================================================
function checkUSStock(code, minYield) {
  var data = fetchUSStockData(code);
  if (!data || !data.currentPrice) return null;

  var metConditions = [];
  var warnings = [];

  if (!data.yieldPct || data.yieldPct < minYield) return null;
  metConditions.push('✅ 配当利回り ' + data.yieldPct.toFixed(2) + '% ≥ ' + minYield + '%');

  if (data.fiftyTwoWeekLow > 0) {
    var fromLow = (data.currentPrice - data.fiftyTwoWeekLow) / data.fiftyTwoWeekLow * 100;
    if (fromLow <= 20) metConditions.push('✅ 52週安値から+' + fromLow.toFixed(1) + '%');
  }
  if (data.fiftyTwoWeekHigh > 0) {
    var dropPct = (data.currentPrice - data.fiftyTwoWeekHigh) / data.fiftyTwoWeekHigh * 100;
    if (dropPct <= -15) metConditions.push('✅ 高値から' + Math.abs(dropPct).toFixed(1) + '%下落');
  }

  return {
    code: code, market: 'us',
    name: data.name || code,
    currentPrice: data.currentPrice,
    yieldPct: data.yieldPct,
    pbr: 0,
    metConditions: metConditions,
    warnings: warnings,
    change: data.change,
    changePct: data.changePct,
  };
}

// ============================================================
// データ取得: 日本株（Yahoo Finance Japan スクレイピング + v8）
// ============================================================
function fetchJapanStockData(code) {
  // Step1: v8 chart → 株価 + 52週レンジ（HTTP 200確認済み）
  var priceData = fetchV8Price(code + '.T');

  // Step2: Yahoo Finance Japan個別ページ → 配当利回り + PBR + 財務指標
  var jpData = fetchYahooJapanData(code);

  var price = (priceData && priceData.price > 0) ? priceData.price
            : (jpData && jpData.price > 0)       ? jpData.price : 0;
  if (!price) return null;

  var yieldPct = (jpData && jpData['yield'] > 0) ? jpData['yield'] : 0;

  return {
    name            : (jpData && jpData.name) || (priceData && priceData.name) || code,
    currentPrice    : price,
    change          : priceData ? priceData.change    : 0,
    changePct       : priceData ? priceData.changePct : 0,
    fiftyTwoWeekLow : priceData ? (priceData.low52  || 0) : 0,
    fiftyTwoWeekHigh: priceData ? (priceData.high52 || 0) : 0,
    yieldPct        : yieldPct,
    pbr             : (jpData && jpData.pbr)         || 0,
    payoutRatio     : (jpData && jpData.payout)      || 0,
    trailingEps     : jpData ? jpData.eps            : undefined,
    roe             : (jpData && jpData.roe)          || 0,
    operatingMargin : (jpData && jpData.opMargin)    || 0,
    equityRatio     : (jpData && jpData.equityRatio) || 0,
    revenueGrowth   : 0,
  };
}

// v8 chart API: 株価・52週レンジ取得
function fetchV8Price(symbol) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
    + encodeURIComponent(symbol) + '?interval=1d&range=1d';
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var meta = JSON.parse(resp.getContentText());
    meta = meta.chart && meta.chart.result && meta.chart.result[0] && meta.chart.result[0].meta;
    if (!meta) return null;
    var price = meta.regularMarketPrice || 0;
    var prev  = meta.chartPreviousClose || meta.previousClose || price;
    return {
      name     : meta.shortName || meta.longName || null,
      price    : price,
      change   : price - prev,
      changePct: prev > 0 ? (price - prev) / prev * 100 : 0,
      low52    : meta.fiftyTwoWeekLow  || 0,
      high52   : meta.fiftyTwoWeekHigh || 0,
    };
  } catch(e) {
    Logger.log('fetchV8Price [' + symbol + ']: ' + e.message);
    return null;
  }
}

// Yahoo Finance Japan 個別株ページ スクレイピング
function fetchYahooJapanData(code) {
  var url = 'https://finance.yahoo.co.jp/quote/' + code + '.T';
  try {
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      }
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('YJP HTTP ' + resp.getResponseCode() + ' [' + code + ']');
      return null;
    }
    return parseYahooJapanHTML(resp.getContentText('UTF-8'), code);
  } catch(e) {
    Logger.log('fetchYahooJapanData [' + code + ']: ' + e.message);
    return null;
  }
}

// HTML解析: __NEXT_DATA__ JSON優先 → regexフォールバック
function parseYahooJapanHTML(html, code) {
  var r = { name: null, price: 0, 'yield': 0, pbr: 0, per: 0,
            payout: 0, eps: undefined, roe: 0, opMargin: 0, equityRatio: 0 };

  // ── Method 1: __NEXT_DATA__ JSON ──
  try {
    var ndM = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (ndM) {
      var nd = JSON.parse(ndM[1]);
      var ex = deepExtract(nd, 0);
      if (ex && (ex['yield'] > 0 || ex.pbr > 0 || ex.price > 0)) {
        Logger.log('YJP JSON OK [' + code + ']: yield=' + ex['yield'] + ' pbr=' + ex.pbr);
        return ex;
      }
    }
  } catch(e) {}

  // ── Method 2: Regex ──
  var titleM = html.match(/<title[^>]*>([^|<(（]+)/);
  if (titleM) r.name = titleM[1].trim().replace(/\s*の株価.*$/, '').trim();

  // 株価
  var pm = html.match(/現在値[^\d]*([\d,]+(?:\.\d+)?)/) ||
           html.match(/"regularMarketPrice"\s*:\s*(\d+(?:\.\d+)?)/);
  if (pm) r.price = parseFloat(pm[1].replace(/,/g, ''));

  // 配当利回り
  var ym = html.match(/配当利回り[^0-9]*?([\d.]+)\s*%/) ||
           html.match(/dividendYield[^0-9]*([\d.]+)/);
  if (ym) { var y = parseFloat(ym[1]); r['yield'] = (y > 0 && y < 1) ? y * 100 : y; }

  // PBR
  var bm = html.match(/PBR[^0-9\-]*([\d.]+)\s*倍/) ||
           html.match(/priceToBook[^0-9]*([\d.]+)/);
  if (bm) r.pbr = parseFloat(bm[1]);

  // PER
  var em = html.match(/PER[^0-9\-]*([\d.]+)\s*倍/) ||
           html.match(/trailingPE[^0-9]*([\d.]+)/);
  if (em) r.per = parseFloat(em[1]);

  // EPS: 赤字表示なら-1、PER+価格があれば計算
  if (/PER[^\d]{0,20}赤字|赤字[^\d]{0,10}PER/.test(html)) {
    r.eps = -1;
  } else if (r.per > 0 && r.price > 0) {
    r.eps = r.price / r.per;
  }

  // 配当性向
  var qm = html.match(/配当性向[^0-9]*([\d.]+)\s*%/) ||
           html.match(/payoutRatio[^0-9]*([\d.]+)/);
  if (qm) { var q = parseFloat(qm[1]); r.payout = q > 1 ? q / 100 : q; }

  // ROE
  var rm = html.match(/ROE[^0-9\-]*([\d.]+)\s*%/) ||
           html.match(/自己資本利益率[^0-9]*([\d.]+)/);
  if (rm) { var rv = parseFloat(rm[1]); r.roe = rv > 1 ? rv / 100 : rv; }

  // 営業利益率
  var om = html.match(/営業利益率[^0-9\-]*([\d.]+)\s*%/);
  if (om) { var ov = parseFloat(om[1]); r.opMargin = ov > 1 ? ov / 100 : ov; }

  // 自己資本比率
  var eqm = html.match(/自己資本比率[^0-9]*([\d.]+)\s*%/);
  if (eqm) { var ev = parseFloat(eqm[1]); r.equityRatio = ev > 1 ? ev / 100 : ev; }

  Logger.log('YJP regex [' + code + ']: yield=' + r['yield'] + ' pbr=' + r.pbr + ' price=' + r.price);
  return r;
}

// JSON内を再帰検索して財務データを抽出
function deepExtract(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 7) return null;
  var r = { name: null, price: 0, 'yield': 0, pbr: 0, per: 0,
            payout: 0, eps: undefined, roe: 0, opMargin: 0, equityRatio: 0 };
  var hit = false;
  var keyMap = {
    dividendYield: 'yield', yieldPercent: 'yield',
    pbr: 'pbr', priceToBook: 'pbr',
    per: 'per', trailingPE: 'per',
    price: 'price', regularMarketPrice: 'price', currentPrice: 'price',
    payoutRatio: 'payout',
    returnOnEquity: 'roe', roe: 'roe',
    operatingMargin: 'opMargin', operatingMargins: 'opMargin',
    equityRatio: 'equityRatio',
    name: 'name', shortName: 'name', displayName: 'name',
    eps: 'eps', trailingEps: 'eps',
  };
  Object.keys(keyMap).forEach(function(k) {
    if (obj[k] !== undefined && obj[k] !== null) {
      var v = obj[k];
      if (typeof v === 'object' && v !== null && v.raw !== undefined) v = v.raw;
      if (keyMap[k] === 'yield') {
        v = parseFloat(v) || 0;
        if (v > 0 && v < 1) v = v * 100;
      } else if (keyMap[k] !== 'name') {
        v = parseFloat(v) || 0;
      }
      r[keyMap[k]] = v;
      hit = true;
    }
  });
  if (hit && (r['yield'] > 0 || r.pbr > 0 || r.price > 0)) return r;

  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var child = obj[keys[i]];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      var found = deepExtract(child, depth + 1);
      if (found && (found['yield'] > 0 || found.pbr > 0 || found.price > 0)) return found;
    }
  }
  return null;
}

// ============================================================
// データ取得: 米国ETF（v8 chart API）
// ============================================================
function fetchUSStockData(code) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
    + encodeURIComponent(code) + '?interval=1d&range=1d';
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var meta = JSON.parse(resp.getContentText());
    meta = meta.chart && meta.chart.result && meta.chart.result[0] && meta.chart.result[0].meta;
    if (!meta) return null;
    var price    = meta.regularMarketPrice || 0;
    var prev     = meta.chartPreviousClose || meta.previousClose || price;
    var yieldRaw = meta.trailingAnnualDividendYield || 0;
    var yieldPct = yieldRaw > 1 ? yieldRaw : (yieldRaw > 0 ? yieldRaw * 100 : 0);
    if (!yieldPct && meta.trailingAnnualDividendRate && price > 0) {
      yieldPct = meta.trailingAnnualDividendRate / price * 100;
    }
    return {
      name            : meta.shortName || meta.longName || code,
      currentPrice    : price,
      change          : price - prev,
      changePct       : prev > 0 ? (price - prev) / prev * 100 : 0,
      fiftyTwoWeekLow : meta.fiftyTwoWeekLow  || 0,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || 0,
      yieldPct        : yieldPct,
      pbr: 0, payoutRatio: 0, trailingEps: undefined,
      roe: 0, operatingMargin: 0, equityRatio: 0, revenueGrowth: 0,
    };
  } catch(e) {
    Logger.log('fetchUSStockData [' + code + ']: ' + e.message);
    return null;
  }
}

// ============================================================
// Yahoo Finance Japan ランキング取得（キャッシュ付き）
// ============================================================
function getJPCandidates() {
  var props = PropertiesService.getScriptProperties();
  var now   = new Date().getTime();
  var last  = props.getProperty('jp_candidates_time');
  if (last && (now - parseInt(last)) / 60000 < CACHE_TTL_MIN) {
    var cached = props.getProperty('jp_candidates');
    if (cached) { var arr = JSON.parse(cached); if (arr.length > 0) return arr; }
  }
  Logger.log('ランキング更新中...');
  var codes = fetchRankingCodes();
  if (codes.length >= 10) {
    props.setProperty('jp_candidates', JSON.stringify(codes));
    props.setProperty('jp_candidates_time', now.toString());
    props.setProperty('batch_pos', '0');
    Logger.log('キャッシュ更新: ' + codes.length + '銘柄');
    return codes;
  }
  Logger.log('ランキング取得失敗 → フォールバック');
  var old = props.getProperty('jp_candidates');
  if (old) { var o = JSON.parse(old); if (o.length > 0) return o; }
  return JP_FALLBACK;
}

function getNextBatch(candidates) {
  if (!candidates || candidates.length === 0) return [];
  var props = PropertiesService.getScriptProperties();
  var pos   = parseInt(props.getProperty('batch_pos') || '0');
  var batch = candidates.slice(pos, pos + BATCH_SIZE);
  props.setProperty('batch_pos', String(pos + BATCH_SIZE >= candidates.length ? 0 : pos + BATCH_SIZE));
  return batch;
}

function fetchRankingCodes() {
  var codes = [], seen = {};
  for (var page = 1; page <= RANKING_PAGES; page++) {
    var url = 'https://finance.yahoo.co.jp/stocks/ranking/dividendYield?market=all&term=daily&page=' + page;
    try {
      var resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: {
          'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        }
      });
      if (resp.getResponseCode() !== 200) continue;
      var html = resp.getContentText();
      var patterns = [
        /\/quote\/(\d{4})\.T\b/g,
        /\/stocks\/detail\/(\d{4})\b/g,
        /"code"\s*:\s*"(\d{4})"/g,
        /code=(\d{4})\b/g,
      ];
      patterns.forEach(function(re) {
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(html)) !== null) {
          var c = m[1];
          if (c >= '1000' && c <= '9999' && !seen[c]) { seen[c] = true; codes.push(c); }
        }
      });
      Utilities.sleep(800);
    } catch(e) {
      Logger.log('fetchRankingCodes p' + page + ': ' + e.message);
    }
  }
  Logger.log('ランキング取得: ' + codes.length + '銘柄');
  return codes;
}

// ============================================================
// Telegram通知
// ============================================================
function sendSignalNotification(sig) {
  var priceStr  = sig.market === 'us' ? '$' + sig.currentPrice.toFixed(2)
                                      : sig.currentPrice.toLocaleString() + '円';
  var changeStr = sig.changePct >= 0 ? '▲+' + sig.changePct.toFixed(2) + '%'
                                     : '▼'  + sig.changePct.toFixed(2) + '%';
  var msg = '🔔 *購入シグナル検出*\n';
  msg += '━━━━━━━━━━━━━━━\n';
  msg += '*' + sig.name + '* (' + sig.code + ')\n';
  msg += '株価: ' + priceStr + '  ' + changeStr + '\n';
  msg += '配当利回り: *' + sig.yieldPct.toFixed(2) + '%*\n';
  if (sig.pbr > 0) msg += 'PBR: ' + sig.pbr.toFixed(2) + '倍\n';
  msg += '\n✅ *クリアした条件 (両学長・こびと株基準)*\n';
  sig.metConditions.forEach(function(c) { msg += c + '\n'; });
  if (sig.warnings && sig.warnings.length > 0) {
    msg += '\n';
    sig.warnings.forEach(function(w) { msg += w + '\n'; });
  }
  msg += '━━━━━━━━━━━━━━━\n';
  msg += '⏰ ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm');
  sendTelegram(msg);
}

function sendTelegram(text) {
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  try {
    UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'Markdown' }),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log('Telegram error: ' + e.message);
  }
}

// ============================================================
// クールダウン管理
// ============================================================
function isCooledDown(code) {
  var last = PropertiesService.getScriptProperties().getProperty('last_notify_' + code);
  if (!last) return true;
  return (new Date().getTime() - parseInt(last)) / 60000 >= COOLDOWN_MINUTES;
}
function setCooldown(code) {
  PropertiesService.getScriptProperties().setProperty('last_notify_' + code, String(new Date().getTime()));
}

// ============================================================
// 診断: Yahoo Finance Japan スクレイピングテスト
// ============================================================
function diagnosisYJP() {
  var code = '8316';
  var msg  = '🔬 YJP診断 (' + code + ')\n\n';

  // v8 price check
  var p = fetchV8Price(code + '.T');
  msg += 'v8 price: ' + (p ? 'OK price=' + p.price + ' 52L=' + p.low52 + ' 52H=' + p.high52 : 'null') + '\n\n';

  // Yahoo Japan page
  var url = 'https://finance.yahoo.co.jp/quote/' + code + '.T';
  try {
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      }
    });
    var http = resp.getResponseCode();
    msg += 'HTTP: ' + http + '\n';
    if (http === 200) {
      var html = resp.getContentText('UTF-8');
      msg += 'HTMLlen: ' + html.length + '\n';
      msg += '__NEXT_DATA__: ' + (html.indexOf('__NEXT_DATA__') >= 0 ? 'あり' : 'なし') + '\n';
      msg += '配当利回りテキスト: ' + (html.indexOf('配当利回り') >= 0 ? 'あり' : 'なし') + '\n';
      msg += 'PBRテキスト: ' + (html.indexOf('PBR') >= 0 ? 'あり' : 'なし') + '\n\n';

      var d = parseYahooJapanHTML(html, code);
      msg += '解析結果:\n';
      msg += '  name: '   + (d.name || 'null') + '\n';
      msg += '  price: '  + d.price + '\n';
      msg += '  yield: '  + d['yield'] + '%\n';
      msg += '  PBR: '    + d.pbr + '倍\n';
      msg += '  PER: '    + d.per + '倍\n';
      msg += '  EPS: '    + (d.eps !== undefined ? d.eps : 'undefined') + '\n';
      msg += '  payout: ' + (d.payout > 0 ? (d.payout*100).toFixed(0)+'%' : '0') + '\n';
      msg += '  ROE: '    + (d.roe > 0 ? (d.roe*100).toFixed(1)+'%' : '0') + '\n';

      // 配当利回りの前後50文字を表示（デバッグ用）
      var idx = html.indexOf('配当利回り');
      if (idx >= 0) {
        msg += '\n[配当利回り周辺]:\n' + html.substring(idx, idx + 120).replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ');
      }
    }
  } catch(e) {
    msg += 'Error: ' + e.message;
  }

  sendTelegram(msg);
  Logger.log(msg);
}

// デバッグ: 特定銘柄の全データ確認
function debugStokk(code) {
  code = code || '8316';
  var data = fetchJapanStockData(code);
  var msg  = '🔍 debugStock(' + code + ')\n';
  if (!data) { sendTelegram(msg + 'データなし'); return; }
  msg += '銘柄名: '      + data.name + '\n';
  msg += '株価: '        + data.currentPrice + '円\n';
  msg += '配当利回り: '  + data.yieldPct.toFixed(2) + '%\n';
  msg += 'PBR: '         + data.pbr.toFixed(2) + '倍\n';
  msg += 'EPS: '         + (data.trailingEps !== undefined ? data.trailingEps.toFixed(0) : 'なし') + '\n';
  msg += '配当性向: '    + (data.payoutRatio > 0 ? (data.payoutRatio*100).toFixed(0)+'%' : 'なし') + '\n';
  msg += 'ROE: '         + (data.roe > 0 ? (data.roe*100).toFixed(1)+'%' : 'なし') + '\n';
  msg += '営業利益率: '  + (data.operatingMargin > 0 ? (data.operatingMargin*100).toFixed(1)+'%' : 'なし') + '\n';
  msg += '自己資本比率: '+ (data.equityRatio > 0 ? (data.equityRatio*100).toFixed(1)+'%' : 'なし') + '\n';
  msg += '52週安値: '    + data.fiftyTwoWeekLow + '円\n';
  msg += '52週高値: '    + data.fiftyTwoWeekHigh + '円\n';
  sendTelegram(msg);
  Logger.log(msg);
}
