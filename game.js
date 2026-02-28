// ==============================================================================
// game.js: 盤面データとメビウス将棋のルールロジック（描画とは分離）
// ==============================================================================

// --- ① グローバル設定・変数 ---
window.pieceNames = {
    'pawn': ['歩', 'と'], 'lance': ['香', '成香'], 'knight': ['桂', '成桂'],
    'silver': ['銀', '成銀'], 'gold': ['金', '金'], 'bishop': ['角', '馬'],
    'rook': ['飛', '竜'], 'king': ['玉', '王']
};

window.boardState = [];
window.capturedHands = { 0: [], 1: [] };
window.gameState = 'playing';
window.historyMap = {};
window.currentValidMoves = [];

// 定数登録（他スクリプトと衝突しないよう window プロパティを利用）
window.PIECE_TYPES = window.PIECE_TYPES || ['pawn','lance','knight','silver','gold','bishop','rook'];
window.PROMOTABLE_TYPES = window.PROMOTABLE_TYPES || ['pawn', 'lance', 'knight', 'silver', 'bishop', 'rook'];
const PROMOTABLE_TYPES = window.PROMOTABLE_TYPES;


// ==============================================================================
// --- ② ヘルパー関数（盤面操作・基礎判定） ---
// ==============================================================================

function copyBoard(board) {
    return board.map(row => row.map(p => p ? {...p} : null));
}

function findKing(board, owner) {
    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            if (board[y][x] && board[y][x].type === 'king' && board[y][x].owner === owner) {
                return {x, y};
            }
        }
    }
    return null;
}

// 成りゾーン判定 (MEBIUS_isPromotionZone が無ければデフォルトの判定を作成)
if (typeof window.MEBIUS_isPromotionZone === 'undefined') {
    window.MEBIUS_isPromotionZone = function(px, py, pOwner) {
        if (px === 0 || px === 8 || py === 0 || py === 8) return false;
        return pOwner === 0 ? (py === 1 || py === 2) : (py === 6 || py === 7);
    };
}

function inAura(x, y, king) {
    if (!king) return false;

    // 1. 盤面の端っこ（ワープ境界）は成りゾーンから除外
    if (x === 0 || x === 8 || y === 0 || y === 8) return false;

    // 2. king には「相手の王様」が渡される想定のため、持ち主を逆算
    let pieceOwner = 1 - king.owner; 

    // 3. 端を除いた「真の敵陣」に入っているか判定
    return pieceOwner === 0 ? (y === 1 || y === 2) : (y === 6 || y === 7);
}


// ==============================================================================
// --- ③ 移動ロジック（ワープ処理と経路探索） ---
// ==============================================================================

function moveOneStep(x, y, dx, dy) {
    let cx = x, cy = y;
    let dRot = 0;

    // X方向 (横) の移動とワープ
    if (dx !== 0) {
        cx += dx;
        if (cx < 0) {
            cx = 8 - cy; cy = 8;
            dRot += 90;
        } else if (cx > 8) {
            cx = 8 - cy; cy = 0;
            dRot += 90;
        }
    }

    // Y方向 (縦) の移動とワープ
    if (dy !== 0) {
        // Xの移動でワープした場合、空間が曲がるため Y の動きを X 軸に適用
        if (dRot === 90) {
            cx += -dy;
            if (cx < 0) {
                cx = 8 - cy; cy = 8; dRot += 90;
            } else if (cx > 8) {
                cx = 8 - cy; cy = 0; dRot += 90;
            }
        } else {
            cy += dy;
            if (cy < 0) {
                cy = 8 - cx; cx = 8; dRot -= 90;
            } else if (cy > 8) {
                cy = 8 - cx; cx = 0; dRot -= 90;
            }
        }
    }

    // 最終的な駒の向き (ndx, ndy) を計算
    let ndx = dx, ndy = dy;
    let rotMod = ((dRot % 360) + 360) % 360;

    if (rotMod === 90) {
        ndx = -dy; ndy = dx;
    } else if (rotMod === 180) {
        ndx = -dx; ndy = -dy;
    } else if (rotMod === 270) {
        ndx = dy; ndy = -dx;
        rotMod = -90;
    }

    return { x: cx, y: cy, dx: ndx, dy: ndy, dRot: rotMod };
}

function calculatePath(board, type, startX, startY, isPromoted, startRotation, owner) {
    let path = [];
    
    const F = {dx: 0, dy: -1, id: 0}, B = {dx: 0, dy: 1, id: 1}, L = {dx: -1, dy: 0, id: 2}, R = {dx: 1, dy: 0, id: 3};
    const FL = {dx: -1, dy: -1, id: 4}, FR = {dx: 1, dy: -1, id: 5}, BL = {dx: -1, dy: 1, id: 6}, BR = {dx: 1, dy: 1, id: 7};
    const cross = [F, B, L, R], diag = [FL, FR, BL, BR];
    const goldMove = [F, FL, FR, L, R, B], silverMove = [F, FL, FR, BL, BR];

    let sliders = [], steppers = [], isKnight = false;
    let effectiveType = isPromoted && ['pawn', 'lance', 'knight', 'silver'].includes(type) ? 'gold' : type;

    switch(effectiveType) {
        case 'pawn': steppers = [F]; break;
        case 'lance': sliders = [F]; break;
        case 'knight': isKnight = true; break;
        case 'silver': steppers = silverMove; break;
        case 'gold': steppers = goldMove; break;
        case 'king': steppers = [...cross, ...diag]; break;
        case 'bishop': sliders = diag; if (isPromoted) steppers = cross; break;
        case 'rook': sliders = cross; if (isPromoted) steppers = diag; break;
    }

    const rotateVector = (dx, dy, angle) => {
        const rad = angle * Math.PI / 180;
        return { 
            dx: Math.round(dx * Math.cos(rad) - dy * Math.sin(rad)), 
            dy: Math.round(dx * Math.sin(rad) + dy * Math.cos(rad)) 
        };
    };

    // 飛車・角・香車の移動（最大18マス）
    sliders.forEach(dir => {
        let cx = startX, cy = startY;
        let rotatedDir = rotateVector(dir.dx, dir.dy, startRotation);
        let cdx = rotatedDir.dx, cdy = rotatedDir.dy, currentRot = startRotation;

        for (let i = 0; i < 18; i++) { 
            let nextPos = moveOneStep(cx, cy, cdx, cdy);
            cx = nextPos.x; cy = nextPos.y; cdx = nextPos.dx; cdy = nextPos.dy; currentRot += nextPos.dRot; 
            
            if (cx < 0 || cx > 8 || cy < 0 || cy > 8) break;
            
            let targetPiece = board[cy][cx];
            let stepCount = i + 1;

            if (targetPiece) {
                // ぐるっと回って自分の背中（初期位置）に戻ってきた場合は有効な手とする
                if (cx === startX && cy === startY) {
                    path.push({x: cx, y: cy, rot: currentRot, dirId: dir.id, dist: stepCount});
                } else if (targetPiece.owner !== owner) {
                    path.push({x: cx, y: cy, rot: currentRot, dirId: dir.id, dist: stepCount}); 
                }
                break;
            }
            path.push({x: cx, y: cy, rot: currentRot, dirId: dir.id, dist: stepCount});
        }
    });

    // 1マスしか進まない駒
    steppers.forEach(dir => {
        let rotatedDir = rotateVector(dir.dx, dir.dy, startRotation);
        let nextPos = moveOneStep(startX, startY, rotatedDir.dx, rotatedDir.dy);
        if (nextPos.x < 0 || nextPos.x > 8 || nextPos.y < 0 || nextPos.y > 8) return;
        
        let targetPiece = board[nextPos.y][nextPos.x];
        if (!targetPiece || targetPiece.owner !== owner || (nextPos.x === startX && nextPos.y === startY)) {
            path.push({x: nextPos.x, y: nextPos.y, rot: startRotation + nextPos.dRot, dirId: dir.id, dist: 1});
        }
    });

    // 桂馬の特殊移動
    if (isKnight) {
        const knightMoves = [
            { steps: [{dx: 0, dy: -1}, {dx: 0, dy: -1}, {dx: -1, dy: 0}], id: 8 },
            { steps: [{dx: 0, dy: -1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}], id: 9 }
        ];
        knightMoves.forEach(km => {
            let cx = startX, cy = startY, currentRot = startRotation;
            for (let step of km.steps) {
                let rotatedDir = rotateVector(step.dx, step.dy, currentRot);
                let nextPos = moveOneStep(cx, cy, rotatedDir.dx, rotatedDir.dy);
                cx = nextPos.x; cy = nextPos.y; currentRot += nextPos.dRot; 
            }
            if (cx < 0 || cx > 8 || cy < 0 || cy > 8) return;
            
            let targetPiece = board[cy][cx];
            if (!targetPiece || targetPiece.owner !== owner || (cx === startX && cy === startY)) {
                path.push({x: cx, y: cy, rot: currentRot, dirId: km.id, dist: 1});
            }
        });
    }

    return path;
}


// ==============================================================================
// --- ④ 応用ルール（王手判定・合法手生成） ---
// ==============================================================================

function isCheck(board, owner) {
    let kingPos = findKing(board, owner);
    if (!kingPos) return true; // 王がいない＝詰み扱い

    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            let p = board[y][x];
            if (p && p.owner !== owner) {
                let paths = calculatePath(board, p.type, x, y, p.isPromoted, p.rotation, p.owner);
                if (paths.some(m => m.x === kingPos.x && m.y === kingPos.y)) return true;
            }
        }
    }
    return false;
}

// 💡 引数の最後に isAI = false を追加
function getValidMoves(board, hands, owner, skipUchifuzume = false, isAI = false) {
    let moves = [];
    
    // --- 盤上の駒を動かす手 ---
    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            let p = board[y][x];
            if (p && p.owner === owner) {
                let paths = calculatePath(board, p.type, x, y, p.isPromoted, p.rotation, owner);
                
                for (let m of paths) {
                    let isValid = true; // デフォルトは「とりあえずOK」とする

                    // 🚨 AI思考中【以外】の時だけ、激重の王手チェックを行う！
                    if (!isAI) {
                        let sim = copyBoard(board);
                        sim[y][x] = null;
                        sim[m.y][m.x] = {...p, rotation: m.rot};
                        isValid = !isCheck(sim, owner);
                    }
                    
                    if (isValid) {
                        let startInZone = window.MEBIUS_isPromotionZone(x, y, owner);
                        let endInZone = window.MEBIUS_isPromotionZone(m.x, m.y, owner);
                        let canPromote = false;

                        if (endInZone) {
                            canPromote = true;
                        } else if (startInZone) {
                            if (Math.abs(y - m.y) < 5) canPromote = true;
                        }

                        canPromote = canPromote && !p.isPromoted && PROMOTABLE_TYPES.includes(p.type);

                        // 不成
                        moves.push({
                            isHand: false, startX: x, startY: y, endX: m.x, endY: m.y, 
                            dirId: m.dirId, dist: m.dist, isPromote: false, rot: m.rot, piece: p
                        });

                        // 成り
                        if (canPromote) {
                            moves.push({
                                isHand: false, startX: x, startY: y, endX: m.x, endY: m.y, 
                                dirId: m.dirId, dist: m.dist, isPromote: true, rot: m.rot, piece: p
                            });
                        }
                    }
                }
            }
        }
    }
    
    // --- 持ち駒を打つ手 ---
    let myHands = hands[owner] || [];
    let uniqueHands = [...new Set(myHands)];
    uniqueHands.forEach(type => {
        let skipCols = [];
        
        // 💡 二歩の判定（ここはコピーが不要で軽いのでAIでも実行する）
        if (type === 'pawn') { 
            for (let cx = 0; cx < 9; cx++) {
                for (let cy = 0; cy < 9; cy++) {
                    let p = board[cy][cx];
                    if (p && p.owner === owner && p.type === 'pawn' && !p.isPromoted) {
                        skipCols.push(cx); break;
                    }
                }
            }
        }

        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                // 駒がなくて、二歩の列でもない場合
                if (!board[y][x] && !skipCols.includes(x)) {
                    
                    let isValid = true;
                    let isUchifuzume = false;

                    // 🚨 AI思考中【以外】の時だけ、激重の王手チェック＆打ち歩詰めチェックを行う！
                    if (!isAI) {
                        let sim = copyBoard(board);
                        sim[y][x] = {type, owner, isPromoted: false, rotation: owner === 0 ? 0 : 180};
                        
                        if (isCheck(sim, owner)) {
                            isValid = false; // 自殺手なのでダメ
                        } else {
                            // 王手放置じゃない場合、打ち歩詰めの確認
                            if (!skipUchifuzume && type === 'pawn' && isCheck(sim, 1-owner)) {
                                let enemyMoves = getValidMoves(sim, hands, 1-owner, true, false);
                                if (enemyMoves.length === 0) isUchifuzume = true; // 打ち歩詰め
                            }
                        }
                    }

                    // AIの場合は無条件で追加（isValid は最初から true）
                    if (isValid && !isUchifuzume) {
                        let pieceIdx = window.PIECE_TYPES ? window.PIECE_TYPES.indexOf(type) : 0;
                        let idx = myHands.indexOf(type);
                        moves.push({
                            isHand: true, type: type, index: idx, 
                            piece_type: pieceIdx, endX: x, endY: y
                        });
                    }
                }
            }
        }
    });

    // --- 重複する手をまとめる（回転などの正規化） ---
    let uniqueMoves = [];
    let seen = new Set();
    for (let m of moves) {
        let normalizedRot = m.rot !== undefined ? ((m.rot % 360) + 360) % 360 : 0;
        let key = `${m.isHand ? 'hand' : `board_${m.startX}_${m.startY}`}_${m.endX}_${m.endY}_${normalizedRot}_${m.isPromote}_${m.type || m.piece?.type || ''}`;
        
        if (!seen.has(key)) {
            seen.add(key);
            uniqueMoves.push(m);
        }
    }

    return uniqueMoves;
}

// ==============================================================================
// --- ⑤ ゲーム状態の管理（初期化・千日手チェック） ---
// ==============================================================================

function initBoard() {
    const newBoard = Array.from({ length: 9 }, () => Array(9).fill(null));
    const place = (x, y, type, owner) => {
        newBoard[y][x] = { type: type, owner: owner, isPromoted: false, rotation: owner === 0 ? 0 : 180 };
    };

    // AI側 (owner: 1)
    place(0, 0, 'lance', 1); place(1, 0, 'knight', 1); place(2, 0, 'silver', 1); place(3, 0, 'gold', 1); place(4, 0, 'king', 1); place(5, 0, 'gold', 1); place(6, 0, 'silver', 1); place(7, 0, 'knight', 1); place(8, 0, 'lance', 1);
    place(1, 1, 'rook', 1); place(7, 1, 'bishop', 1);
    for (let i = 0; i < 9; i++) place(i, 2, 'pawn', 1);

    // プレイヤー側 (owner: 0)
    for (let i = 0; i < 9; i++) place(i, 6, 'pawn', 0);
    place(1, 7, 'bishop', 0); place(7, 7, 'rook', 0);
    place(0, 8, 'lance', 0); place(1, 8, 'knight', 0); place(2, 8, 'silver', 0); place(3, 8, 'gold', 0); place(4, 8, 'king', 0); place(5, 8, 'gold', 0); place(6, 8, 'silver', 0); place(7, 8, 'knight', 0); place(8, 8, 'lance', 0);
    
    window.boardState = newBoard;
    window.capturedHands = { 0: [], 1: [] };
    window.historyMap = {};
}

function recordState(currentPlayer) {
    // 向き（rotation）を無視した盤面ハッシュを作成
    let stateStr = window.boardState.map(r => r.map(p => p ? `${p.owner}${p.type}${p.isPromoted?1:0}` : '').join(',')).join('/') 
                 + '|' + window.capturedHands[0].slice().sort().join('') + '|' + window.capturedHands[1].slice().sort().join('') + '|' + currentPlayer;

    window.historyMap[stateStr] = (window.historyMap[stateStr] || 0) + 1;

    // 4回同じ配置になったら千日手
    if (window.historyMap[stateStr] >= 4) {
        if (window.endGame) window.endGame("千日手（引き分け）です！");
        return true;
    }
    return false;
}


// ==============================================================================
// --- ⑥ グローバルへのエクスポート・初期実行 ---
// ==============================================================================

window.initBoard = initBoard;
window.copyBoard = copyBoard;
window.findKing = findKing;
window.inAura = inAura;
window.isCheck = isCheck;
window.moveOneStep = moveOneStep;
window.calculatePath = calculatePath;
window.getValidMoves = getValidMoves;
window.recordState = recordState;

// ファイル読み込み時に初期化
initBoard();