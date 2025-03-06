// ページのロードを待ってから初期化処理を開始
window.addEventListener('load', function() {
  console.log('Page loaded, initializing Calendar Selector extension...');
  
  initializeExtension();
});

// 拡張機能の初期化
function initializeExtension() {
  // カレンダーマネージャーが初期化されるのを待つ
  waitForCalendarManager();
  
  // 定期的に拡張機能のコンテキストをチェック
  setInterval(checkExtensionContext, 3000);
}

// 拡張機能のコンテキストをチェック
function checkExtensionContext() {
  if (chrome && chrome.runtime) {
    try {
      // ping を送信してコンテキストが有効かチェック
      chrome.runtime.sendMessage({action: 'ping'}, function(response) {
        // エラーがなく、レスポンスがあれば正常
        if (chrome.runtime.lastError) {
          console.warn('Extension context check failed:', chrome.runtime.lastError);
          // エラーハンドリングはコールバック内のlastErrorで行うので例外はスローしない
        }
      });
    } catch (e) {
      console.error('Extension context invalid, attempting recovery...');
      // ページをリロードして拡張機能を再初期化
      setTimeout(() => {
        location.reload();
      }, 1000);
    }
  }
}

// CalendarManagerが利用可能になるまで待つ
function waitForCalendarManager() {
  console.log('Waiting for CalendarManager...');
  
  if (window.CalendarManager && CalendarManager.calendars) {
    console.log('CalendarManager is ready');
    
    // グループをロード
    loadGroups(function() {
      // UIを挿入
      insertSimpleUI();
      
      // 定期的にグループが消失していないか確認
      setInterval(function() {
        try {
          const hasGroups = CalendarManager.groups && 
                         Object.keys(CalendarManager.exportGroups(false)).length > 0;
          
          if (!hasGroups) {
            console.log('Groups disappeared, reloading...');
            loadGroups();
          }
        } catch (e) {
          console.error('Error checking groups:', e);
        }
      }, 3000);
    });
  } else {
    // まだ利用可能でなければ再試行
    setTimeout(waitForCalendarManager, 200);
  }
}

// バックグラウンドからグループを読み込む
function loadGroups(callback) {
  console.log('Loading groups from background...');
  
  if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      chrome.runtime.sendMessage({ action: 'getGroups' }, function(response) {
        // chrome.runtime.lastError をチェック（これはthrowされない）
        if (chrome.runtime.lastError) {
          console.error('Error getting groups:', chrome.runtime.lastError);
          initFallbackGroups();
          if (typeof callback === 'function') callback();
          return;
        }
        
        if (response && response.success && response.groups) {
          try {
            // ディープコピーを作成して設定
            const groupsCopy = JSON.parse(JSON.stringify(response.groups));
            
            // バージョンを確認し、必要に応じて移行
            if (typeof groupsCopy.__v === 'undefined') {
              groupsCopy.__v = 1;
            }
            
            // __last_saved が配列であることを確認
            if (!Array.isArray(groupsCopy.__last_saved)) {
              groupsCopy.__last_saved = [];
            }
            
            CalendarManager.setGroups(groupsCopy);
            console.log('Groups loaded from background:', CalendarManager.groups);
          } catch (e) {
            console.error('Error processing groups data:', e);
            initFallbackGroups();
          }
        } else {
          console.error('Failed to load groups from background');
          initFallbackGroups();
        }
        
        if (typeof callback === 'function') {
          callback();
        }
      });
    } catch (e) {
      console.error('Exception during message sending:', e);
      initFallbackGroups();
      if (typeof callback === 'function') callback();
    }
  } else {
    console.error('Cannot communicate with background script');
    initFallbackGroups();
    
    if (typeof callback === 'function') {
      callback();
    }
  }
}

// フォールバックグループの初期化
function initFallbackGroups() {
  CalendarManager.setGroups({ "__last_saved": [], "__v": 1 });
}

// グループをバックグラウンドに保存
function storeGroups() {
  console.log('Storing groups to background...');
  
  try {
    // exportGroups で複製を作成してから変更する
    let exportedGroups = CalendarManager.exportGroups(true);
    
    // 自動保存の制限（最新の3つのみ保持）
    const savedEntries = Object.keys(exportedGroups)
      .filter(name => name && name.indexOf('saved_') === 0)
      .sort();
    
    if (savedEntries.length > 3) {
      const to_remove = savedEntries.slice(0, savedEntries.length - 3);
      
      to_remove.forEach(name => {
        delete exportedGroups[name];
        if (exportedGroups.__last_saved) {
          const idx = exportedGroups.__last_saved.indexOf(name);
          if (idx >= 0) {
            exportedGroups.__last_saved.splice(idx, 1);
          }
        }
      });
    }
    
    // migrate storage format, if necessary
    if (typeof exportedGroups.__v === 'undefined') {
      exportedGroups = migrateToV1(exportedGroups);
    }
    
    // バージョン情報の追加
    exportedGroups.__v = 1;
    
    // バックグラウンドに保存
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      const presetNames = Object.keys(CalendarManager.exportGroups(false, exportedGroups));
      
      try {
        chrome.runtime.sendMessage({ 
          action: 'saveGroups', 
          groups: exportedGroups 
        }, function(response) {
          // chrome.runtime.lastError をチェック
          if (chrome.runtime.lastError) {
            console.error('Error saving groups:', chrome.runtime.lastError);
            message('Failed to save presets: ' + chrome.runtime.lastError.message);
            return;
          }
          
          if (response && response.success) {
            console.log('Groups saved to background successfully');
            message('Presets saved: ' + presetNames.join(', '));
          } else {
            console.error('Failed to save groups to background');
            message('Failed to save presets');
          }
        });
      } catch (e) {
        console.error('Exception during message sending:', e);
        message('Failed to save presets: Communication error');
      }
    } else {
      console.error('Cannot communicate with background script');
      message('Failed to save presets: Extension API not available');
    }
    
    return true;
  } catch (e) {
    console.error('Error saving groups:', e);
    message('Error saving presets: ' + e.message);
    return false;
  }
}

// 簡易版UI関数
function insertSimpleUI(insertLoc) {
  // 既存のUIがあれば削除（重複防止）
  $('#calendar_selector_simple_ui').remove();
  
  // jQueryを使った簡単なUIを作成
  var div = $('<div id="calendar_selector_simple_ui" style="margin: 10px 0;"></div>');
  
  // Enable ボタン
  var enableBtn = $('<button style="margin-right: 5px;">Enable</button>');
  enableBtn.click(function() {
    var calendar_name = prompt('Enable calendar by name (case insensitive regex)');
    if(calendar_name) CalendarManager.enableCalendar(calendar_name);
  });
  div.append(enableBtn);
  
  // Save As ボタン
  var saveAsBtn = $('<button style="margin-right: 5px;">Save As</button>');
  saveAsBtn.click(function() {
    var group_name = prompt('Save Group name');
    if(group_name) {
      CalendarManager.saveCalendarSelections(group_name).then(() => {
        storeGroups();
      })
    }
  });
  div.append(saveAsBtn);
  
  // Restore ボタン
  var restoreBtn = $('<button style="margin-right: 5px;">Restore</button>');
  restoreBtn.click(function() {
    CalendarManager.restoreCalendarSelections();
  });
  div.append(restoreBtn);
  
  // Clear ボタン
  var clearBtn = $('<button style="margin-right: 5px;">Clear</button>');
  clearBtn.click(function() {
    CalendarManager.performOperation(async () => {
      await CalendarManager.saveCalendarSelections();
      await CalendarManager.disableAll();
    }, 'clear');
  });
  div.append(clearBtn);
  
  // Presets ボタン
  var presetsBtn = $('<button style="margin-right: 5px;">Presets</button>');
  presetsBtn.click(function() {
    showPresetsMenu(this);
  });
  div.append(presetsBtn);
  
  // デバッグボタン
  var debugBtn = $('<button style="margin-right: 5px;">Debug</button>');
  debugBtn.click(function() {
    // 現在のグループデータの状態を表示
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ action: 'getGroups' }, (response) => {
          if (chrome.runtime.lastError) {
            alert("エラー: " + chrome.runtime.lastError.message);
            return;
          }
          
          const debugInfo = {
            inMemory: CalendarManager.groups ? Object.keys(CalendarManager.exportGroups(false)).length : 0,
            background: response && response.groups ? Object.keys(CalendarManager.exportGroups(false, response.groups)).length : 0
          };
          
          alert(
            "メモリ内プリセット数: " + debugInfo.inMemory + "\n" +
            "バックグラウンド内プリセット数: " + debugInfo.background + "\n\n" +
            "メモリ内グループデータ: " + JSON.stringify(CalendarManager.exportGroups(false)).substring(0, 100) + "..."
          );
        });
      } catch (e) {
        alert("エラー: " + e.message);
      }
    } else {
      alert("拡張機能APIが利用できません");
    }
  });
  div.append(debugBtn);
  
  // インサート位置が指定されていればそこに、なければデフォルト位置に挿入
  if(insertLoc) {
    $(insertLoc).append(div);
  } else {
    try {
      var insertAfter = document.querySelectorAll('header > div:nth-child(2) > div:nth-child(2) > div:nth-child(1)')[0];
      $(insertAfter).after(div);
    } catch(e) {
      // セレクタが見つからない場合のフォールバック
      $('header').after(div);
    }
  }
  
  console.log('UI inserted with groups:', CalendarManager.groups);
}

// Presetsメニューを表示する関数
function showPresetsMenu(buttonElement) {
  // 既存のメニューを削除
  $('#presets-menu').remove();
  
  // グループリストを取得
  var groups = CalendarManager.exportGroups(false);
  var groupNames = Object.keys(groups);
  
  if (groupNames.length === 0) {
    message('No presets available');
    return;
  }
  
  // メニューを作成
  var menu = $('<div id="presets-menu" style="position: absolute; background: white; border: 1px solid #ccc; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 1000; padding: 5px;"></div>');
  
  // グループごとのメニュー項目を追加
  groupNames.forEach(function(groupName) {
    var item = $('<div style="padding: 8px 16px; cursor: pointer; display: flex; justify-content: space-between;"></div>')
      .mouseover(function() { $(this).css('background-color', '#f1f1f1'); })
      .mouseout(function() { $(this).css('background-color', ''); });
    
    // グループ名と選択機能
    var nameSpan = $('<span></span>').text(groupName).click(function() {
      CalendarManager.performOperation(async () => {
        await CalendarManager.saveCalendarSelections();
        await CalendarManager.showGroup(groupName);
      }, 'select_input');
      menu.remove();
    });
    
    // 削除ボタン
    var deleteBtn = $('<span style="margin-left: 10px; color: #999;">✕</span>').click(function(e) {
      e.stopPropagation();
      if (confirm('Are you sure you want to delete this preset?')) {
        CalendarManager.deleteGroup(groupName);
        storeGroups();
        menu.remove();
      }
    });
    
    item.append(nameSpan).append(deleteBtn);
    menu.append(item);
  });
  
  // インポート/エクスポートボタンを追加
  var actionArea = $('<div style="border-top: 1px solid #eee; padding: 8px 16px; display: flex; justify-content: space-between;"></div>');
  
  actionArea.append($('<span style="cursor: pointer; color: #1a73e8;">Import</span>').click(function() {
    var jsonStr = prompt('Paste JSON preset data:');
    if (jsonStr) {
      try {
        var importedGroups = JSON.parse(jsonStr);
        CalendarManager.setGroups(importedGroups);
        storeGroups();
        menu.remove();
        message('Presets imported successfully');
      } catch (e) {
        message('Error importing presets: ' + e.message);
      }
    }
  }));
  
  actionArea.append($('<span style="cursor: pointer; color: #1a73e8;">Export</span>').click(function() {
    var exportData = JSON.stringify(CalendarManager.exportGroups(true));
    // テキストエリアを作成してエクスポートデータを表示
    var textarea = $('<textarea style="width: 100%; height: 200px;"></textarea>').val(exportData);
    var exportDialog = $('<div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; box-shadow: 0 0 10px rgba(0,0,0,0.5); z-index: 1001;"></div>')
      .append('<div style="margin-bottom: 10px; font-weight: bold;">Export Presets</div>')
      .append(textarea)
      .append('<div style="text-align: right; margin-top: 10px;"><button>Close</button></div>');
    
    exportDialog.find('button').click(function() {
      exportDialog.remove();
    });
    
    $('body').append(exportDialog);
    textarea.select();
    menu.remove();
  }));
  
  menu.append(actionArea);
  
  // メニューを配置して表示
  var buttonPos = $(buttonElement).offset();
  menu.css({
    top: buttonPos.top + $(buttonElement).outerHeight() + 'px',
    left: buttonPos.left + 'px'
  });
  
  // 外部クリックでメニューを閉じる
  $(document).on('click.presetsMenu', function(e) {
    if (!$(e.target).closest('#presets-menu, button:contains("Presets")').length) {
      menu.remove();
      $(document).off('click.presetsMenu');
    }
  });
  
  $('body').append(menu);
}

// snackbarの実装
var snackbar;
function message(msg){
  if(!snackbar) {
    snackbar = $.parseHTML(`
      <div id="snackbar" class="mdl-js-snackbar mdl-snackbar">
        <div class="mdl-snackbar__text"></div>
        <button class="mdl-snackbar__action" type="button"></button>
      </div>
    `)[1];
    componentHandler.upgradeElements(snackbar);
    $('body').append(snackbar);
  }
  
  snackbar.MaterialSnackbar.showSnackbar({
    message: msg,
    timeout: 5000,
  });
}

function migrateToV1(groups){
  const name2id = (calName) => {
    const cal = CalendarManager.calendars.byName[calName];
    if(cal){
      return cal.id;
    } else {
      // if a calendar for given name is not found, keep original name
      // (assume it's either for a different account, or already an id)
      return calName;
    }
  };

  const v1Groups = {};
  for(let groupName of Object.keys(CalendarManager.exportGroups(false, groups))){
    v1Groups[groupName] = groups[groupName].map(name2id);
  }

  return v1Groups;
}

// Google Calendar SPAアプリケーションでのナビゲーション変更を監視
function setupNavigationListener() {
  // URL変更を監視するための関数
  const checkUrlChange = () => {
    if (window.lastUrl !== location.href) {
      window.lastUrl = location.href;
      console.log('URL changed to:', location.href);
      
      // URLが変更されたら、再度UIを挿入
      setTimeout(() => {
        if (window.CalendarManager && CalendarManager.calendars) {
          // グループデータをリロード
          loadGroups(() => {
            insertSimpleUI();
          });
        }
      }, 1000);
    }
  };
  
  // 定期的にURLをチェック
  window.lastUrl = location.href;
  setInterval(checkUrlChange, 1000);
}

// ナビゲーション変更リスナーを設定
setupNavigationListener();