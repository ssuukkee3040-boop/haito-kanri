// ============================================================
// 高配当銘柄 購入シグナル通知bot
// 条件を満たした銘柄が現れた時だけTelegramに通知する
// ============================================================

// ==================== 設定（必ず変更） ====================
var TELEGRAM_TOKEN = '8502192155:AAE_yJ_k6EEYH-U9-0xdXbbHC0lu-S96_oc';   // BotFatherから取得
var TELEGRAM_CHAT_ID = '8789739101';  // @userinfobot で確認

// ==================== 監視銘柄リスト ====================
// ウォッチリストに追加したい銘柄を手動で設定
// code: ティッカーまたは証券コード
// market: 'us' または 'japan'
// minScore: 最低スコア（Aランク=105推奨, Sランク=130）
// minYield: 最低配当利回り(%) 例: 3.75 = 3.75%以上
// maxPbr:   最大PBR 例: 1.5 = PBR1.5以下（0=チェックしない）
// checkYahoo: Yahoo Financeから現在株価・配当利回りを取得するか
var WATCHLIST = [
  { code: 'VYM',  market: 'us',     minYield: 3.0,  maxPbr: 0, checkYahoo: true },
  { code: 'HDV',  market: 'us',     minYield: 3.5,  maxPbr: 0, checkYahoo: true },
  { code: 'SPYD', market: 'us',     minYield: 4.0,  maxPbr: 0, checkYahoo: true },
  { code: 'ARCC', market: 'us',     minYield: 9.0,  maxPbr: 0, checkYahoo: true },
  { code: 'QQQ',  market: 'us',     minYield: 0.5,  maxPbr: 0, checkYahoo: true },
  // 日本株の例（証券コード）
  // { code: '8058', market: 'japan', minYield: 3.75, maxPbr: 1.5, checkYahoo: true },
  // { code: '9433', market: 'japan', minYield: 3.75, maxPbr: 1.5, checkYahoo: true },
];

// 通知のクールダウン（同じ銘柄を連続通知しない）分
var COOLDOWN_MINUTES = 360;  // 6時間

// ==================== メイン処理 ====================
// トリガー設定: 5分ごと or 10分ごとに実行
function checkBuySignals() {
  var signals = [];

  WATCHLIST.forEach(function(item) {
    try {
      var data = fetchStockData(item.code, item.market);
      if (!data) return;

      var metConditions = [];
      var missedConditions = [];

      // --- 条件チェック ---

      // 1. 配当利回りチェック
      if (item.minYield > 0) {
        if (data.yieldPct >= item.minYield) {
          metConditions.push('✅ 配当利回り ' + data.yieldPct.toFixed(2) + '%（目標≥' + item.minYield + '%）');
        } else {
          missedConditions.push('❌ 配当利回り ' + data.yieldPct.toFixed(2) + '%（目標≥' + item.minYield + '%）');
        }
      }

      // 2. PBRチェック（0=スキップ）
      if (item.maxPbr > 0 && data.pbr > 0) {
        if (data.pbr <= item.maxPbr) {
          metConditions.push('✅ PBR ' + data.pbr.toFixed(2) + '（目標≤' + item.maxPbr + '）');
        } else {
          missedConditions.push('❌ PBR ' + data.pbr.toFixed(2) + '（目標≤' + item.maxPbr + '）');
        }
      }

      // 3. 52週安値からの乖離（値ごろ感チェック）
      if (data.fiftyTwoWeekLow > 0 && data.currentPrice > 0) {
        var fromLow = (data.currentPrice - data.fiftyTwoWeekLow) / data.fiftyTwoWeekLow * 100;
        if (fromLow <= 15) {
          metConditions.push('✅ 52週安値から+' + fromLow.toFixed(1) + '%（割安圏内）');
        }
      }

      // 4. 配当利回りが52週最高水準（≥90パーセンタイル相当）
      if (data.yieldPct > 0 && data.fiftyTwoWeekHigh > 0) {
        var priceFromHigh = (data.currentPrice - data.fiftyTwoWeekHigh) / data.fiftyTwoWeekHigh * 100;
        if (priceFromHigh <= -20) {
          metConditions.push('✅ 高値から' + Math.abs(priceFromHigh).toFixed(1) + '%下落（配当利回り上昇中）');
        }
      }

      // --- 通知判定：設定した必須条件を全て満したした場合のみ ---
      var requiredMet = true;
      if (item.minYield > 0 && data.yieldPct < item.minYield) requiredMet = false;
      if (item.maxPbr > 0 && data.pbr > 0 && data.pbr > item.maxPbr) requiredMet = false;

      if (requiredMet && metConditions.length > 0) {
        signals.push({
          code: item.code,
          market: item.market,
          name: data.name || item.code,
          currentPrice: data.currentPrice,
          currency: item.market === 'us' ? 'USD' : '円',
          yieldPct: data.yieldPct,
          pbr: data.pbr,
          metConditions: metConditions,
          change: data.change,
          changePct: data.changePct,
        });
      }
    } catch(e) {
      Logger.log('Error checking ' + item.code + ': ' + e.message);
    }
  });

  // 通知送信
  signals.forEach(function(sig) {
    if (!isCooledDown(sig.code)) return;
    sendSignalNotification(sig);
    setCooldown(sig.code);
  });

  Logger.log('チェック完了: ' + WATCHLIST.length + '銘柄, シグナル: ' + signals.length + '件');
}

// ==================== 通知メッセージ送信 ====================
function sendSignalNotification(sig) {
  var priceStr = sig.market === 'us'
    ? '$' + sig.currentPrice.toFixed(2)
    : sig.currentPrice.toLocaleString() + '円';

  var changeStr = sig.changePct >= 0
    ? '▲+' + sig.changePct.toFixed(2) + '%'
    : '▼' + sig.changePct.toFixed(2) + '%';

  var msg = '🔔 *購入シグナル検出*\n';
  msg += '━━━━━━━━━━━━━━━\n';
  msg += '*' + sig.name + '* (' + sig.code + ')\n';
  msg += '現在株価: ' + priceStr + '  ' + changeStr + '\n';
  msg += '配当利回り: ' + sig.yieldPct.toFixed(2) + '%\n';
  if (sig.pbr > 0) msg += 'PBR: ' + sig.pbr.toFixed(2) + '\n';
  msg += '\n📋 *満たしている条件*\n';
  sig.metConditions.forEach(function(c) {
    msg += c + '\n';
  });
  msg += '━━━━━━━━━━━━━━━\n';
  msg += '⏰ ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm');

  sendTelegram(msg);
}

// ==================== Yahoo Finance データ取得 ====================
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

    // 配当利回りと財務データはv10から取得
    var summary = fetchSummaryData(symbol);

    return {
      name: meta.shortName || meta.longName || code,
      currentPrice: currentPrice,
      change: change,
      changePct: changePct,
      yieldPct: summary.yieldPct || 0,
      pbr: summary.pbr || 0,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow || 0,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || 0,
    };
  } catch(e) {
    Logger.log('fetchStockData error ' + code + ': ' + e.message);
    return null;
  }
}

function fetchSummaryData(symbol) {
  var url = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(symbol)
          + '?modules=summaryDetail,defaultKeyStatistics';
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return {};
    var json = JSON.parse(resp.getContentText());
    var result = json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0];
    if (!result) return {};

    var summary = result.summaryDetail || {};
    var stats = result.defaultKeyStatistics || {};

    var rawYield = summary.dividendYield && summary.dividendYield.raw || 0;
    var yieldPct = rawYield > 1 ? rawYield : rawYield * 100; // 0.045 → 4.5%

    return {
      yieldPct: yieldPct,
      pbr: stats.priceToBook && stats.priceToBook.raw || 0,
    };
  } catch(e) {
    return {};
  }
}

// ==================== Telegram送信 ====================
function sendTelegram(text) {
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  var payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'Markdown'
  };
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log('Telegram error: ' + e.message);
  }
}

// ==================== クールダウン管理 ====================
function isCooledDown(code) {
  var props = PropertiesService.getScriptProperties();
  var key = 'last_notify_' + code;
  var last = props.getProperty(key);
  if (!last) return true;
  var elapsed = (new Date().getTime() - parseInt(last)) / 60000;
  return elapsed >= COOLDOWN_MINUTES;
}

function setCooldown(code) {
  PropertiesService.getScriptProperties().setProperty(
    'last_notify_' + code,
    new Date().getTime().toString()
  );
}

// ==================== トリガー設定 ====================
// この関数を一度だけ手動実行してトリガーを設定する
function setupTrigger() {
  // 既存トリガーを全削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
  // 10分ごとに checkBuySignals を実行
  ScriptApp.newTrigger('checkBuySignals')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('✅ トリガー設定完了: 10分ごとに checkBuySignals を実行');
}

// 全トリガー削除（通知を停止したい時）
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
  Logger.log('✅ 全トリガーを削除しました');
}

// 動作テスト（手動実行用）
function testNotification() {
  sendTelegram('🔔 *購入シグナル検出*\n━━━━━━━━━━━━━━━\n*テスト通知* (TEST)\n現在株価: $50.00  ▼-1.20%\n配当利回り: 4.25%\n\n📋 *満たしている条件*\n✅ 配当利回り 4.25%（目標≥4.0%）\n✅ 52週安値から+8.3%（割安圏内）\n━━━━━━━━━━━━━━━\n⏰ テスト送信');
  Logger.log('テスト通知送信完了');
}
