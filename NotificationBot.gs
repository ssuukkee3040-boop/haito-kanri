// ============================================================
// 高配当銘柄 購入シグナル通知bot【両学長・こびと株 完全準拠版】
// Yahoo Finance Japanランキングから東証全銘柄を動的スキャン
// 参考: こびと株.com 10条件 / リベラルアーツ大学 高配当株基準
// ============================================================

// ==================== Telegram設定 ====================
var TELEGRAM_TOKEN   = '8502192155:AAE_yJ_k6EEYH-U9-0xdXbbHC0lu-S96_oc';
var TELEGRAM_CHAT_ID = '8789739101';

// ============================================================
// 日本株スクリーニング条件（両学長 + こびと株 統合基準）
// ============================================================
var JP_MIN_YIELD = 3.75;
var JP_MAX_YIELD = 8.0;
var JP_MAX_PBR = 1.5;
var JP_MAX_PAYOUT = 0.70;
var JP_MIN_OP_MARGIN = 0.03;
var JP_REQUIRE_POSITIVE_EPS = true;
var JP_GOOD_OP_MARGIN = 0.10;
var JP_GOOD_EQUITY_RATIO = 0.50;
var JP_GOOD_ROE = 0.08;
var JP_GOOD_PAYOUT = 0.50;
var JP_MAX_FROM_LOW = 20.0;
var JP_MIN_DROP     = 15.0;

// ============================================================
// 米国ETF固定リスト
// ============================================================
var US_WATCHLIST = [
  { code: 'VYM',  minYield: 3.0 },
  { code: 'HDV',  minYield: 3.5 },
  { code: 'SPYD', minYield: 4.0 },
  { code: 'ARCC', minYield: 9.0 },
];

// ============================================================
// 動的スクリーニング設定
// ============================================================
var RANKING_PAGES = 5;
var CACHE_TTL_MIN = 60;
var BATCH_SIZE    = 25;
var COOLDOWN_MINUTES = 360;

// ============================================================
// フォールバック静的リスト
// ============================================================
var JP_FALLBACK = [
  '8058','8031','8053','8001','8002',
  '9433','9432','9434','9437',
  '8316','8411','8306','8309','8308',
  '8725','8750','8766','8795','8630',
  '9501','9502','9503','9504','9505','9531','9532',
  '1605','5020','5019',
  '9101','9104','9107',
  '8802','8801','8830','8803',
  '2914','2802','2503','2502','2501','2269',
  '7261','7270',
  '1801','1802','1803','1812','1808','1925',
  '8028','8267','9843',
  '5401','5411','5713','5801',
  '4183','4004','4005','4042',
  '6361','6301','6302',
  '9021','9022','9020',
  '8015','8016',
  '4502','4503','4519',
  '4689','4768'
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
    } catch(e) { Logger.log('JP error [' + code + ']: ' + e.message); }
    Utilities.sleep(300);
  });

  US_WATCHLIST.forEach(function(item) {
    try {
      var result = checkUSStock(item.code, item.minYield);
      if (result) signals.push(result);
    } catch(e) { Logger.log('US error [' + item.code + ']: ' + e.message); }
    Utilities.sleep(300);
  });

  signals.forEach(function(sig) {
    if (!isCooledDown(sig.code)) return;
    sendSignalNotification(sig);
    setCooldown(sig.code);
  });

  Logger.log('完了 | バッチ:' + jpBatch.length + ' ETF:' + US_WATCHLIST.length + ' シグナル:' + signals.length);
}

// ============================================================
// 日本株スクリーニング
// ============================================================
function checkJapanStock(code) {
  var data = fetchStockData(code, 'japan');
  if (!data || !data.currentPrice || data.currentPrice <= 0) return null;

  var metConditions = [];
  var warnings      = [];

  if (!data.yieldPct || data.yieldPct <= 0) return null;
  if (data.yieldPct < JP_MIN_YIELD) return null;
  if (data.yieldPct > JP_MAX_YIELD) {
    Logger.log('[罠除外] ' + code + ' 利回り' + data.yieldPct.toFixed(1) + '%(8%超)');
    return null;
  }
  if (JP_REQUIRE_POSITIVE_EPS && data.trailingEps !== null && data.trailingEps !== undefined) {
    if (data.trailingEps <= 0) {
      Logger.log('[罠除外] ' + code + ' EPS=' + data.trailingEps + '(赤字)');
      return null;
    }
  }
  if (data.payoutRatio > 0 && data.payoutRatio > JP_MAX_PAYOUT) {
    Logger.log('[罠除外] ' + code + ' 配当性向' + (data.payoutRatio*100).toFixed(0) + '%(70%超)');
    return null;
  }
  if (data.operatingMargin !== null && data.operatingMargin !== undefined && data.operatingMargin !== 0) {
    if (data.operatingMargin < JP_MIN_OP_MARGIN) {
      Logger.log('[罠除外] ' + code + ' 営業利益率' + (data.operatingMargin*100).toFixed(1) + '%(3%未満)');
      return null;
    }
  }

  metConditions.push('✅ 配当利回り ' + data.yieldPct.toFixed(2) + '% ≥ ' + JP_MIN_YIELD + '%');

  if (data.pbr > 0) {
    if (data.pbr <= JP_MAX_PBR) metConditions.push('✅ PBR ' + data.pbr.toFixed(2) + '倍（≤ ' + JP_MAX_PBR + '倍）');
    else warnings.push('⚠️ PBR ' + data.pbr.toFixed(2) + '倍（目標 ≤ ' + JP_MAX_PBR + '倍）');
  }
  if (data.payoutRatio > 0) {
    var pp = (data.payoutRatio*100).toFixed(0);
    if (data.payoutRatio <= JP_GOOD_PAYOUT) metConditions.push('✅ 配当性向 ' + pp + '%（余裕あり ≤ 50%）');
    else warnings.push('⚠️ 配当性向 ' + pp + '%（50〜70%はやや高め）');
  }
  if (data.operatingMargin > 0) {
    var op = (data.operatingMargin*100).toFixed(1);
    metConditions.push('✅ 営業利益率 ' + op + '% ' + (data.operatingMargin >= JP_GOOD_OP_MARGIN ? '(優良 ≥ 10%)' : '(健全 ≥ 3%)'));
  }
  if (data.roe > 0 && data.roe >= JP_GOOD_ROE) metConditions.push('✅ ROE ' + (data.roe*100).toFixed(1) + '%（収益力あり ≥ 8%）');
  if (data.equityRatio > 0) {
    var er = (data.equityRatio*100).toFixed(1);
    if (data.equityRatio >= JP_GOOD_EQUITY_RATIO) metConditions.push('✅ 自己資本比率 ' + er + '%（財務健全 ≥ 50%）');
    else if (data.equityRatio < 0.30) warnings.push('⚠️ 自己資本比率 ' + er + '%（30%未満は財務リスク）');
  }
  if (data.revenueGrowth > 0) metConditions.push('✅ 増収 +' + (data.revenueGrowth*100).toFixed(1) + '%');

  if (data.fiftyTwoWeekLow > 0) {
    var fl = (data.currentPrice - data.fiftyTwoWeekLow) / data.fiftyTwoWeekLow * 100;
    if (fl <= JP_MAX_FROM_LOW) metConditions.push('✅ 52週安値から+' + fl.toFixed(1) + '%（割安圏）');
  }
  if (data.fiftyTwoWeekHigh > 0) {
    var dp = (data.currentPrice - data.fiftyTwoWeekHigh) / data.fiftyTwoWeekHigh * 100;
    if (dp <= -JP_MIN_DROP) metConditions.push('✅ 高値から' + Math.abs(dp).toFixed(1) + '%下落（利回り上昇中）');
  }

  if (metConditions.length === 0) return null;

  return {
    code: code, market: 'japan', name: data.name || code,
    currentPrice: data.currentPrice, yieldPct: data.yieldPct, pbr: data.pbr || 0,
    metConditions: metConditions, warnings: warnings, change: data.change, changePct: data.changePct,
  };
}

// ============================================================
// 米国ETFスクリーニング
// ============================================================
function checkUSStock(code, minYield) {
  var data = fetchStockData(code, 'us');
  if (!data || !data.currentPrice) return null;
  var metConditions = [], warnings = [];
  if (!data.yieldPct || data.yieldPct < minYield) return null;
  metConditions.push('✅ 配当利回り ' + data.yieldPct.toFixed(2) + '% ≥ ' + minYield + '%');
  if (data.fiftyTwoWeekLow > 0) {
    var fl = (data.currentPrice - data.fiftyTwoWeekLow) / data.fiftyTwoWeekLow * 100;
    if (fl <= 20) metConditions.push('✅ 52週安値から+' + fl.toFixed(1) + '%（割安圏）');
  }
  if (data.fiftyTwoWeekHigh > 0) {
    var dp = (data.currentPrice - data.fiftyTwoWeekHigh) / data.fiftyTwoWeekHigh * 100;
    if (dp <= -15) metConditions.push('✅ 高値から' + Math.abs(dp).toFixed(1) + '%下落');
  }
  return { code: code, market: 'us', name: data.name || code, currentPrice: data.currentPrice,
    yieldPct: data.yieldPct, pbr: 0, metConditions: metConditions, warnings: warnings,
    change: data.change, changePct: data.changePct };
}

// ============================================================
// ランキング取得（キャッシュ付き）
// ============================================================
function getJPCandidates() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date().getTime();
  var lastFetch = props.getProperty('jp_candidates_time');
  if (lastFetch && (now - parseInt(lastFetch)) / 60000 < CACHE_TTL_MIN) {
    var cached = props.getProperty('jp_candidates');
    if (cached) { var arr = JSON.parse(cached); if (arr.length > 0) return arr; }
  }
  Logger.log('ランキング更新中...');
  var codes = fetchRankingCodes();
  if (codes.length >= 10) {
    props.setProperty('jp_candidates', JSON.stringify(codes));
    props.setProperty('jp_candidates_time', now.toString());
    props.setProperty('batch_pos', '0');
    return codes;
  }
  Logger.log('ランキング取得失敗 → フォールバック');
  var oldCache = props.getProperty('jp_candidates');
  if (oldCache) { var old = JSON.parse(oldCache); if (old.length > 0) return old; }
  return JP_FALLBACK;
}

function getNextBatch(candidates) {
  if (!candidates || candidates.length === 0) return [];
  var props = PropertiesService.getScriptProperties();
  var pos = parseInt(props.getProperty('batch_pos') || '0');
  var batch = candidates.slice(pos, pos + BATCH_SIZE);
  props.setProperty('batch_pos', (pos + BATCH_SIZE >= candidates.length ? 0 : pos + BATCH_SIZE).toString());
  return batch;
}

function fetchRankingCodes() {
  var codes = [], seen = {};
  for (var page = 1; page <= RANKING_PAGES; page++) {
    var url = 'https://finance.yahoo.co.jp/stocks/ranking/dividendYield?market=all&term=daily&page=' + page;
    try {
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html', 'Accept-Language': 'ja,en-US;q=0.9' }});
      if (resp.getResponseCode() !== 200) continue;
      var html = resp.getContentText();
      var patterns = [/\/quote\/(\d{4})\.T\b/g, /\/stocks\/detail\/(\d{4})\b/g,
        /\/detail\/(\d{4})\b/g, /"code"\s*:\s*"(\d{4})"/g,
        /code=(\d{4})\b/g, /symbol[=:"']+(\d{4})\.T\b/gi];
      patterns.forEach(function(re) {
        re.lastIndex = 0; var m;
        while ((m = re.exec(html)) !== null) {
          var c = m[1];
          if (c && c >= '1000' && c <= '9999' && !seen[c]) { seen[c] = true; codes.push(c); }
        }
      });
      Utilities.sleep(800);
    } catch(e) { Logger.log('fetchRankingCodes p' + page + ': ' + e.message); }
  }
  Logger.log('ランキング: ' + codes.length + '銘柄');
  return codes;
}

// ============================================================
// Yahoo Finance データ取得
// ============================================================
function fetchStockData(code, market) {
  var symbol = market === 'japan' ? code + '.T' : code;
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=1d';
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var json = JSON.parse(resp.getContentText());
    var meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;
    if (!meta) return null;

    var currentPrice = meta.regularMarketPrice || 0;
    var prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;
    var change = currentPrice - prevClose;
    var changePct = prevClose > 0 ? change / prevClose * 100 : 0;

    var yieldFromChart = 0;
    if (meta.trailingAnnualDividendYield != null && meta.trailingAnnualDividendYield > 0) {
      var raw = meta.trailingAnnualDividendYield;
      yieldFromChart = raw > 1 ? raw : raw * 100;
    } else if (meta.trailingAnnualDividendRate && currentPrice > 0) {
      yieldFromChart = meta.trailingAnnualDividendRate / currentPrice * 100;
    }

    var summary = fetchSummaryData(symbol, yieldFromChart);

    return {
      name: meta.shortName || meta.longName || code,
      currentPrice: currentPrice, change: change, changePct: changePct,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow || 0, fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || 0,
      yieldPct: summary.yieldPct > 0 ? summary.yieldPct : yieldFromChart,
      pbr: summary.pbr || 0, payoutRatio: summary.payoutRatio || 0,
      trailingEps: summary.trailingEps, roe: summary.roe || 0,
      operatingMargin: summary.operatingMargin || 0, equityRatio: summary.equityRatio || 0,
      revenueGrowth: summary.revenueGrowth || 0,
    };
  } catch(e) { Logger.log('fetchStockData [' + code + ']: ' + e.message); return null; }
}

function fetchSummaryData(symbol, yieldFallback) {
  var url = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(symbol)
    + '?modules=summaryDetail,defaultKeyStatistics,financialData,balanceSheetHistoryQuarterly';
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return { yieldPct: yieldFallback };
    var json = JSON.parse(resp.getContentText());
    var result = json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0];
    if (!result) return { yieldPct: yieldFallback };

    var sd = result.summaryDetail || {}, ks = result.defaultKeyStatistics || {};
    var fd = result.financialData || {}, bs = result.balanceSheetHistoryQuarterly || {};

    var rawYield = sd.dividendYield && sd.dividendYield.raw || 0;
    var yieldPct = rawYield > 1 ? rawYield : rawYield * 100;
    if (yieldPct <= 0 && yieldFallback > 0) yieldPct = yieldFallback;

    var payout = sd.payoutRatio && sd.payoutRatio.raw || 0;
    if (payout > 2) payout = 0;

    var eps = undefined;
    if (ks.trailingEps && ks.trailingEps.raw !== undefined) eps = ks.trailingEps.raw;

    var equityRatio = 0;
    try {
      var stmts = bs.balanceSheetStatements;
      if (stmts && stmts.length > 0) {
        var eq = stmts[0].totalStockholderEquity && stmts[0].totalStockholderEquity.raw || 0;
        var as = stmts[0].totalAssets && stmts[0].totalAssets.raw || 0;
        if (as > 0) equityRatio = eq / as;
      }
    } catch(e2) {}

    return {
      yieldPct: yieldPct, pbr: ks.priceToBook && ks.priceToBook.raw || 0,
      payoutRatio: payout, trailingEps: eps,
      roe: fd.returnOnEquity && fd.returnOnEquity.raw || 0,
      operatingMargin: fd.operatingMargins && fd.operatingMargins.raw || 0,
      revenueGrowth: fd.revenueGrowth && fd.revenueGrowth.raw || 0,
      equityRatio: equityRatio,
    };
  } catch(e) { return { yieldPct: yieldFallback }; }
}

// ============================================================
// Telegram通知
// ============================================================
function sendSignalNotification(sig) {
  var priceStr = sig.market === 'us' ? '$' + sig.currentPrice.toFixed(2) : sig.currentPrice.toLocaleString() + '円';
  var changeStr = sig.changePct >= 0 ? '▲+' + sig.changePct.toFixed(2) + '%' : '▼' + sig.changePct.toFixed(2) + '%';
  var msg = '🔔 *購入シグナル検出*\n━━━━━━━━━━━━━━━\n';
  msg += '*' + sig.name + '* (' + sig.code + ')\n';
  msg += '株価: ' + priceStr + '  ' + changeStr + '\n';
  msg += '配当利回り: *' + sig.yieldPct.toFixed(2) + '%*\n';
  if (sig.pbr > 0) msg += 'PBR: ' + sig.pbr.toFixed(2) + '倍\n';
  msg += '\n✅ *クリアした条件 (両学長・こびと株基準)*\n';
  sig.metConditions.forEach(function(c) { msg += c + '\n'; });
  if (sig.warnings && sig.warnings.length > 0) { msg += '\n'; sig.warnings.forEach(function(w) { msg += w + '\n'; }); }
  msg += '━━━━━━━━━━━━━━━\n';
  msg += '⏰ ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm');
  sendTelegram(msg);
}

function sendTelegram(text) {
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  try {
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'Markdown' }),
      muteHttpExceptions: true });
  } catch(e) { Logger.log('Telegram error: ' + e.message); }
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
  PropertiesService.getScriptProperties().setProperty('last_notify_' + code, new Date().getTime().toString());
}

// ============================================================
// トリガー管理
// ============================================================
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkBuySignals').timeBased().everyMinutes(10).create();
  Logger.log('✅ トリガー設定完了');
}
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log('✅ 全トリガー削除');
}

// ============================================================
// デバッグ・ユーティリティ
// ============================================================
function diagnosisAPI() {
  var symbol = '8316.T';
  var results = '';

  try {
    var r1 = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=1d&range=1d', { muteHttpExceptions: true });
    var j1 = JSON.parse(r1.getContentText());
    var m = j1.chart && j1.chart.result && j1.chart.result[0] && j1.chart.result[0].meta;
    results += '[v8 chart]\n  HTTP: ' + r1.getResponseCode() + '\n  price: ' + (m ? m.regularMarketPrice : 'null') + '\n  divYield: ' + (m ? m.trailingAnnualDividendYield : 'null') + '\n  divRate: ' + (m ? m.trailingAnnualDividendRate : 'null') + '\n';
  } catch(e) { results += '[v8 chart] ERROR: ' + e.message + '\n'; }
  Utilities.sleep(500);

  try {
    var r2 = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + symbol, { muteHttpExceptions: true });
    var j2 = JSON.parse(r2.getContentText());
    var q = j2.quoteResponse && j2.quoteResponse.result && j2.quoteResponse.result[0];
    results += '[v7 quote]\n  HTTP: ' + r2.getResponseCode() + '\n  price: ' + (q ? q.regularMarketPrice : 'null') + '\n  divYield: ' + (q ? q.trailingAnnualDividendYield : 'null') + '\n  divRate: ' + (q ? q.trailingAnnualDividendRate : 'null') + '\n';
  } catch(e) { results += '[v7 quote] ERROR: ' + e.message + '\n'; }
  Utilities.sleep(500);

  try {
    var r3 = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v10/finance/quoteSummary/' + symbol + '?modules=summaryDetail', { muteHttpExceptions: true });
    var j3 = JSON.parse(r3.getContentText());
    var sd = j3.quoteSummary && j3.quoteSummary.result && j3.quoteSummary.result[0] && j3.quoteSummary.result[0].summaryDetail;
    results += '[v10 summaryDetail]\n  HTTP: ' + r3.getResponseCode() + '\n  divYield: ' + (sd && sd.dividendYield ? sd.dividendYield.raw : 'null') + '\n  divRate: ' + (sd && sd.dividendRate ? sd.dividendRate.raw : 'null') + '\n  payout: ' + (sd && sd.payoutRatio ? sd.payoutRatio.raw : 'null') + '\n';
  } catch(e) { results += '[v10 summaryDetail] ERROR: ' + e.message + '\n'; }
  Utilities.sleep(500);

  try {
    var r4 = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v10/finance/quoteSummary/' + symbol + '?modules=summaryDetail,defaultKeyStatistics,financialData', { muteHttpExceptions: true });
    var j4 = JSON.parse(r4.getContentText());
    var res4 = j4.quoteSummary && j4.quoteSummary.result && j4.quoteSummary.result[0];
    var sd4 = res4 && res4.summaryDetail || {};
    var ks4 = res4 && res4.defaultKeyStatistics || {};
    var fd4 = res4 && res4.financialData || {};
    results += '[v10 full]\n  HTTP: ' + r4.getResponseCode() + '\n  divYield: ' + (sd4.dividendYield ? sd4.dividendYield.raw : 'null') + '\n  PBR: ' + (ks4.priceToBook ? ks4.priceToBook.raw : 'null') + '\n  EPS: ' + (ks4.trailingEps ? ks4.trailingEps.raw : 'null') + '\n  ROE: ' + (fd4.returnOnEquity ? fd4.returnOnEquity.raw : 'null') + '\n  opMargin: ' + (fd4.operatingMargins ? fd4.operatingMargins.raw : 'null') + '\n';
  } catch(e) { results += '[v10 full] ERROR: ' + e.message + '\n'; }

  Logger.log(results);
  sendTelegram('🧪 *API診断 (8316.T)*\n' + results);
}

function debugStock(code) {
  code = code || '8316';
  var symbol = code + '.T';
  var urlV8 = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=1d';
  var respV8 = UrlFetchApp.fetch(urlV8, { muteHttpExceptions: true });
  var metaRaw = {};
  try {
    var jsonV8 = JSON.parse(respV8.getContentText());
    metaRaw = jsonV8.chart && jsonV8.chart.result && jsonV8.chart.result[0] && jsonV8.chart.result[0].meta || {};
  } catch(e) {}

  var v8YieldRaw = metaRaw.trailingAnnualDividendYield || 0;
  var v8DivRate  = metaRaw.trailingAnnualDividendRate  || 0;
  var v8Price    = metaRaw.regularMarketPrice || 0;
  var v8Calc     = v8Price > 0 && v8DivRate > 0 ? (v8DivRate / v8Price * 100) : 0;
  var v8Pct      = v8YieldRaw > 0 ? (v8YieldRaw > 1 ? v8YieldRaw : v8YieldRaw * 100) : v8Calc;

  var data = fetchStockData(code, 'japan');
  if (!data) { sendTelegram('❌ ' + code + ' データ取得失敗'); return; }

  var result = checkJapanStock(code);
  var msg = '🔍 *デバッグ: ' + data.name + ' (' + code + ')*\n';
  msg += '株価: ' + data.currentPrice.toLocaleString() + '円\n';
  msg += '[v8] 配当利回り: ' + v8Pct.toFixed(2) + '%\n';
  msg += '[最終] 配当利回り: ' + (data.yieldPct||0).toFixed(2) + '%\n';
  msg += 'PBR: ' + (data.pbr > 0 ? data.pbr.toFixed(2) + '倍' : 'データなし') + '\n';
  msg += '配当性向: ' + (data.payoutRatio > 0 ? (data.payoutRatio*100).toFixed(0)+'%' : 'データなし') + '\n';
  msg += 'EPS: ' + (data.trailingEps !== undefined ? data.trailingEps : 'データなし') + '\n';
  msg += 'ROE: ' + (data.roe > 0 ? (data.roe*100).toFixed(1)+'%' : 'データなし') + '\n';
  msg += '営業利益率: ' + (data.operatingMargin > 0 ? (data.operatingMargin*100).toFixed(1)+'%' : 'データなし') + '\n';
  msg += '自己資本比率: ' + (data.equityRatio > 0 ? (data.equityRatio*100).toFixed(1)+'%' : 'データなし') + '\n';
  msg += '\n→ ' + (result ? '✅ シグナルあり！' : '❌ 条件未達');
  sendTelegram(msg);
  if (result) sendSignalNotification(result);
}

function testFetchRanking() {
  var codes = fetchRankingCodes();
  var msg = codes.length >= 10
    ? '✅ ランキング取得成功: ' + codes.length + '銘柄\n先頭10件: ' + codes.slice(0,10).join(', ')
    : '⚠️ ' + codes.length + '件のみ → フォールバック(' + JP_FALLBACK.length + '銘柄)使用中';
  sendTelegram(msg);
}

function checkCacheStatus() {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('jp_candidates');
  var time   = props.getProperty('jp_candidates_time');
  var pos    = props.getProperty('batch_pos') || '0';
  if (cached && time) {
    var arr = JSON.parse(cached);
    var age = Math.round((new Date().getTime() - parseInt(time)) / 60000);
    sendTelegram('📊 キャッシュ\n銘柄数: ' + arr.length + '\n経過: ' + age + '分\n次バッチ: ' + pos + '番目\n全周期: 約' + Math.ceil(arr.length/BATCH_SIZE*10) + '分');
  } else { sendTelegram('📊 キャッシュなし'); }
}

function resetCache() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('jp_candidates'); props.deleteProperty('jp_candidates_time');
  props.setProperty('batch_pos', '0');
  Logger.log('✅ キャッシュリセット');
}

function testNotification() {
  sendTelegram('🔔 *購入シグナル検出*\n━━━━━━━━━━━━━━━\n*三井住友FG【テスト】* (8316)\n株価: 3,850円  ▼-1.20%\n配当利回り: *4.25%*\nPBR: 0.82倍\n\n✅ *クリアした条件 (両学長・こびと株基準)*\n✅ 配当利回り 4.25% ≥ 3.75%\n✅ PBR 0.82倍（≤ 1.5倍）\n✅ 配当性向 38%（余裕あり ≤ 50%）\n✅ 営業利益率 22.1%（優良 ≥ 10%）\n✅ ROE 9.8%（収益力あり ≥ 8%）\n━━━━━━━━━━━━━━━\n⏰ テスト送信');
}
