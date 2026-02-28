// ==============================================================================
// engine.js: 評価関数・手適用の軽量エンジン
// ==============================================================================

// ヘルパー: 座標が盤面内か
function inRange(x,y){
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x <= 8 && y >= 0 && y <= 8;
}

// エンジン側の成り判定ヘルパー
function isPromotionZoneEngine(x,y,owner){
    if (!inRange(x,y)) return false;
    if (x === 0 || x === 8 || y === 0 || y === 8) return false;
    return owner === 0 ? (y === 1 || y === 2) : (y === 6 || y === 7);
}

// 💡 メビウス空間の「真の最短距離」を計算する共通ヘルパー
// （他のどの関数の中にも入れず、一番外側に独立して置く！）
function getMobiusDistance(x1, y1, x2, y2) {
    let ghosts = [
        { x: x2, y: y2 },             // そのままの距離
        { x: y2 + 9, y: x2 },         // 右ワープ（x>8）の向こう側にいる幻影
        { x: y2 - 9, y: x2 },         // 左ワープ（x<0）の向こう側にいる幻影
        { x: y2, y: x2 - 9 },         // 上ワープ（y<0）の向こう側にいる幻影
        { x: y2, y: x2 + 9 },         // 下ワープ（y>8）の向こう側にいる幻影
        { x: -x2 - 1, y: -y2 - 1 },   // 左上コーナー（点対称）の幻影
        { x: 17 - x2, y: -y2 - 1 },   // 右上コーナーの幻影
        { x: -x2 - 1, y: 17 - y2 },   // 左下コーナーの幻影
        { x: 17 - x2, y: 17 - y2 }    // 右下コーナーの幻影
    ];

    let minDist = Infinity;
    for (let g of ghosts) {
        let d = Math.max(Math.abs(x1 - g.x), Math.abs(y1 - g.y)); 
        if (d < minDist) minDist = d;
    }
    return minDist;
}

// --- 🧠 伝統的かつ強力な手作り評価関数 ---
const pieceValues = {
    'pawn': 100, 'lance': 300, 'knight': 300, 'silver': 500,
    'gold': 600, 'bishop': 800, 'rook': 1000, 'king': 10000
};

const promotedValues = {
    'pawn': 600, 'lance': 600, 'knight': 600, 'silver': 600,
    'bishop': 1100, 'rook': 1300
};


// --- 🧠 評価関数（メビウス空間の物理法則・完全対応版） ---
function evaluateBoard(board, hands, owner = 0) {
    let score = 0;
    let kingPos = { 0: null, 1: null };

    // 💡 1. まず両者の王様の位置を把握する
    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            let p = board[y][x];
            if (p && p.type === 'king') kingPos[p.owner] = { x, y };
        }
    }

    // 💡 2. メビウス空間の「真の最短距離」を計算する魔法の関数
    function getMobiusDistance(x1, y1, x2, y2) {
        // 目標地点(x2, y2)がワープの向こう側にある場合の「幻影（ゴースト）座標」を生成
        // （Pythonの rotate_view と rotate_180_and_flip_pieces を逆算した座標変換）
        let ghosts = [
            { x: x2, y: y2 },             // そのままの距離
            { x: y2 + 9, y: x2 },         // 右ワープ（x>8）の向こう側にいる幻影
            { x: y2 - 9, y: x2 },         // 左ワープ（x<0）の向こう側にいる幻影
            { x: y2, y: x2 - 9 },         // 上ワープ（y<0）の向こう側にいる幻影
            { x: y2, y: x2 + 9 },         // 下ワープ（y>8）の向こう側にいる幻影
            { x: -x2 - 1, y: -y2 - 1 },   // 左上コーナー（点対称）の幻影
            { x: 17 - x2, y: -y2 - 1 },   // 右上コーナーの幻影
            { x: -x2 - 1, y: 17 - y2 },   // 左下コーナーの幻影
            { x: 17 - x2, y: 17 - y2 }    // 右下コーナーの幻影
        ];

        let minDist = Infinity;
        for (let g of ghosts) {
            // 斜め移動も1歩とみなす「チェビシェフ距離」で全ルートの最短を測る
            let d = Math.max(Math.abs(x1 - g.x), Math.abs(y1 - g.y)); 
            if (d < minDist) minDist = d;
        }
        return minDist;
    }

    // 💡 3. 王様の「逃げ道」の数を数える関数（メビウスワープ対応）
    function getEscapeRoutes(kx, ky, kOwner) {
        let safeSquares = 0;
        let moves = [
            [-1, -1], [0, -1], [1, -1],
            [-1,  0],          [1,  0],
            [-1,  1], [0,  1], [1,  1]
        ];

        for (let m of moves) {
            let nx = kx + m[0];
            let ny = ky + m[1];

            // 盤面外に出た場合のワープ座標変換
            if (nx > 8)      { let t = nx; nx = ny; ny = t - 9; }
            else if (ny < 0) { let t = ny; ny = nx; nx = t + 9; }
            else if (nx < 0) { let t = nx; nx = ny; ny = t + 9; }
            else if (ny > 8) { let t = ny; ny = nx; nx = t - 9; }
            
            // （簡易化のため、コーナー点対称へのダイレクト移動は除外）
            if (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 8) {
                let p = board[ny][nx];
                // 空きマスか、相手の駒がいるマスなら「逃げ道」としてカウント
                if (!p || p.owner !== kOwner) {
                    safeSquares++;
                }
            }
        }
        return safeSquares;
    }

    // --- 盤面の各駒の評価 ---
    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            let p = board[y][x];
            if (!p) continue;
            
            let val = (p.isPromote || p.isPromoted) 
                ? (promotedValues[p.type] || pieceValues[p.type] + 300) 
                : pieceValues[p.type] || 0;

            let posBonus = 0;
            let myKing = kingPos[p.owner];
            let enemyKing = kingPos[1 - p.owner];

            // ① ワープ越しに敵の王様を狙うボーナス
            if (enemyKing && p.type !== 'king') {
                let distToEnemyKing = getMobiusDistance(x, y, enemyKing.x, enemyKing.y);
                if (distToEnemyKing <= 4) {
                    // 敵の王様に近いほど点数が高い（ワープを使った奇襲を好むようになる）
                    posBonus += (5 - distToEnemyKing) * 15;
                }
            }

            // ② 自分の王様を護衛するボーナス（金や銀など）
            if (myKing && (p.type === 'gold' || p.type === 'silver')) {
                let distToMyKing = getMobiusDistance(x, y, myKing.x, myKing.y);
                if (distToMyKing <= 2) {
                    posBonus += 30; // 近くにいるだけで評価
                }
            }

            if (p.owner === owner) {
                score += (val + posBonus);
            } else {
                score -= (val + posBonus);
            }
        }
    }

    // --- 王様の逃げ道（安全性）の評価 ---
    for (let kOwner = 0; kOwner <= 1; kOwner++) {
        let king = kingPos[kOwner];
        if (king) {
            let escapes = getEscapeRoutes(king.x, king.y, kOwner);
            let safetyScore = 0;
            
            // 逃げ道がない（詰まされそう）なほど強烈なマイナス評価
            if (escapes === 0) safetyScore = -400; // 逃げ道0は即死の危険
            else if (escapes === 1) safetyScore = -150;
            else if (escapes === 2) safetyScore = -50;
            else safetyScore = escapes * 10; // 逃げ道が多いほど安心

            if (kOwner === owner) {
                score += safetyScore;
            } else {
                score -= safetyScore;
            }
        }
    }

    // --- 持ち駒の評価 ---
    const handMultiplier = 1.15;
    for (let p of (hands[owner] || [])) {
        score += (pieceValues[p] || 0) * handMultiplier;
    }
    for (let p of (hands[1 - owner] || [])) {
        score -= (pieceValues[p] || 0) * handMultiplier;
    }

    return score;
}

// 盤面で手を動かすヘルパー関数
function applyMove(board, hands, move, owner) {
    if (move.isHand) {
        board[move.endY][move.endX] = { 
            type: move.type, 
            owner: owner, 
            isPromoted: false, 
            rotation: owner === 0 ? 0 : 180 
        };
        hands[owner].splice(move.index, 1);
    } else {
        let targetPiece = board[move.endY][move.endX];
        if (targetPiece && (move.startX !== move.endX || move.startY !== move.endY)) {
            hands[owner].push(targetPiece.type);
        }

        let simPiece = { ...move.piece, rotation: move.rot !== undefined ? move.rot : (owner === 0 ? 0 : 180) };
        if ((isPromotionZoneEngine(move.startX, move.startY, owner) || isPromotionZoneEngine(move.endX, move.endY, owner))
            && !simPiece.isPromoted && !['king', 'gold'].includes(simPiece.type)) {
            simPiece.isPromoted = true;
        }
        
        board[move.endY][move.endX] = simPiece;
        if (move.startX !== move.endX || move.startY !== move.endY) {
            board[move.startY][move.startX] = null;
        }
    }
}

// 🧠 オーダリング（探索の優先度付け）
// 良い手（駒を取る、成る）を先に計算させることで、AIの先読み効率を劇的に上げる
function sortMovesForEngine(moves, board) {
    return moves.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        // 相手の駒を取る手は優先（取れる駒の価値が高いほど最優先）
        let targetA = a.isHand ? null : board[a.endY][a.endX];
        let targetB = b.isHand ? null : board[b.endY][b.endX];
        
        if (targetA) scoreA += pieceValues[targetA.type] || 0;
        if (targetB) scoreB += pieceValues[targetB.type] || 0;

        // 成る手も優先
        if (a.isPromote) scoreA += 300;
        if (b.isPromote) scoreB += 300;

        // 王手になるかもしれない手（簡易的に前進する手を少し評価）
        if (!a.isHand && a.endY < a.startY) scoreA += 10;
        if (!b.isHand && b.endY < b.startY) scoreB += 10;

        return scoreB - scoreA; // スコアが高い順（降順）に並び替え
    });
}

// makeMove: 破壊的に盤面を変更して undo 情報を返す（AI の内部探索用）
function makeMove(board, hands, move, owner, promoDecision) {
    const undo = { move: move, owner: owner, prevHands: {0: [...hands[0]], 1: [...hands[1]]}, prevStart: null, prevEnd: null };
    if (move.isHand) {
        undo.prevEnd = board[move.endY] ? board[move.endY][move.endX] : null;
        board[move.endY][move.endX] = { type: move.type, owner: owner, isPromoted: false, rotation: owner === 0 ? 0 : 180 };
        if (move.index !== undefined && move.index !== null) {
            hands[owner].splice(move.index, 1);
        } else {
            const idx = hands[owner].indexOf(move.type);
            if (idx >= 0) hands[owner].splice(idx,1);
        }
    } else {
        undo.prevStart = board[move.startY] ? {...board[move.startY][move.startX]} : null;
        undo.prevEnd = board[move.endY] ? (board[move.endY][move.endX] ? {...board[move.endY][move.endX]} : null) : null;

        if (undo.prevEnd && (move.startX !== move.endX || move.startY !== move.endY)) {
            hands[owner].push(undo.prevEnd.type);
        }

        const simPiece = { ... (board[move.startY][move.startX] || move.piece), rotation: move.rot !== undefined ? move.rot : (owner === 0 ? 0 : 180) };

        let isPromo = false;
        if (promoDecision !== undefined && promoDecision !== null) {
            isPromo = !!promoDecision;
        } else {
            if ((isPromotionZoneEngine(move.startX, move.startY, owner) || isPromotionZoneEngine(move.endX, move.endY, owner))
                && !simPiece.isPromoted && !['king', 'gold'].includes(simPiece.type)) {
                isPromo = true;
            }
        }
        if (isPromo) simPiece.isPromoted = true;

        board[move.endY][move.endX] = simPiece;
        if (board[move.startY] && (move.startX !== move.endX || move.startY !== move.endY)) {
            board[move.startY][move.startX] = null;
        }
    }
    return undo;
}

// undoMove: 探索が終わった後に盤面を元に戻す
function undoMove(board, hands, undo) {
    if (!undo) return;
    if (undo.prevHands) {
        hands[0] = [...undo.prevHands[0]];
        hands[1] = [...undo.prevHands[1]];
    }
    if (undo.prevStart) {
        board[undo.move.startY][undo.move.startX] = {...undo.prevStart};
    } else if (undo.move && !undo.move.isHand && board[undo.move.startY]) {
        board[undo.move.startY][undo.move.startX] = null;
    }
    
    // 亡霊（エラー文）を消して、正しい状態に戻しました
    if (undo.prevEnd) {
        board[undo.move.endY][undo.move.endX] = {...undo.prevEnd};
    } else {
        board[undo.move.endY][undo.move.endX] = null;
    }
}

// --- ⚡ 超高速 Minimax (Alpha-Beta枝刈り + MVV-LVA オーダリング) ---
let lastYieldTime = Date.now();

// --- ⚡ 超高速 Minimax (枝刈り + MVV-LVA + 連続王手の詰み探索) ---
async function evaluateMoveDeepTraditional(board, hands, owner, depth, startTime, timeLimitMs, alpha = -Infinity, beta = Infinity) {
    if (Date.now() - startTime > timeLimitMs) return 0;

    if (Date.now() - lastYieldTime > 50) {
        await new Promise(r => setTimeout(r, 0));
        lastYieldTime = Date.now();
    }

    const amIInCheck = window.isCheck ? window.isCheck(board, owner) : false;

    // 🌟 限界突破の鍵：スタンドパット（Stand-pat）
    // 手を生成する【前】に、今の盤面の点数を測ります！
    let standPat = -Infinity;
    if (depth <= 0) {
        // 深すぎる泥沼は即終了
        if (depth <= -5) return window.evaluateBoard ? window.evaluateBoard(board, hands, owner) : 0;

        standPat = window.evaluateBoard ? window.evaluateBoard(board, hands, owner) : 0;
        
        if (!amIInCheck) {
            // 💡 今の盤面ですでに目標点（beta）を超えているなら、これ以上読まずに即座に枝刈り！
            // ➡ 手を生成する処理（getValidMoves）すらスキップされるため、劇的に速くなります！
            if (standPat >= beta) return beta;
            if (standPat > alpha) alpha = standPat;
            
            // 奇跡の詰みがなさそうな時の足切り
            if (depth === 0) {
                let hasHand = (hands[owner] || []).length > 0;
                if (standPat < 500 && !hasHand) return standPat;
            }
        }
    }

    // 🌟 ここで初めて合法手を生成する（不要な生成を大幅に回避できる！）
    const validMoves = window.getValidMoves ? window.getValidMoves(board, hands, owner, false, true) : [];
    
    if (validMoves.length === 0) return -10000; 
    const canTakeKing = validMoves.find(m => {
        let target = board[m.endY] && board[m.endY][m.endX];
        return target && target.type === 'king';
    });
    if (canTakeKing) return 10000;

    // --- 手のオーダリング（高速化版） ---
    const myKing = window.findKing ? window.findKing(board, owner) : null;

    validMoves.forEach(m => {
        let score = 0;
        let target = board[m.endY] && board[m.endY][m.endX];
        
        if (target) {
            score += (pieceValues[target.type] || 0) * 10;
            let attacker = (m.startX !== undefined && board[m.startY]) ? board[m.startY][m.startX] : null;
            if (attacker) score -= (pieceValues[attacker.type] || 0);
        }

        if (m.isPromote) score += 500;

        if (myKing) {
            if (window.getMobiusDistance && window.getMobiusDistance(myKing.x, myKing.y, m.endX, m.endY) <= 2) {
                score += 50;
            }
        }
        m._sortScore = score;
    });

    validMoves.sort((a, b) => b._sortScore - a._sortScore);
    
    // 💡 延長戦（QS）の場合は、ベースの評価値（standPat）を bestVal の最低ラインにする！
    // （無理して駒を取って損するくらいなら、何もしない方がマシという判断ができる）
    let bestVal = (depth <= 0 && !amIInCheck) ? standPat : -Infinity;
    let moveCount = 0; 

    // --- メインの探索ループ ---
    for (let move of validMoves) {
        moveCount++;

        if (depth <= 0) {
            if (!amIInCheck) {
                let isCapture = move.isHand ? false : !!board[move.endY][move.endX];
                if (!isCapture && !move.isPromote) continue; 
            }
        } else {
            // 通常モード：平和な時は上位5手以降をスキップ
            if (!amIInCheck && moveCount > 5) {
                let isCapture = move.isHand ? false : !!board[move.endY][move.endX];
                if (!isCapture && !move.isPromote) continue; 
            }
        }

        const undo = makeMove(board, hands, move, owner);
        const val = -await evaluateMoveDeepTraditional(board, hands, 1 - owner, depth - 1, startTime, timeLimitMs, -beta, -alpha);
        undoMove(board, hands, undo);
        
        if (val > bestVal) bestVal = val;
        if (bestVal > alpha) alpha = bestVal;
        
        if (alpha >= beta) break; 
    }

    return bestVal;
}

// --- 🧠 トラディショナルAI メイン思考ルーチン ---
async function getBestMoveTraditional(board, hands, owner) {
    const validMoves = window.getValidMoves ? window.getValidMoves(board, hands, owner) : [];
    if (validMoves.length === 0) return null;
    if (validMoves.length === 1) return validMoves[0];

    const TIME_LIMIT_MS = 12000; 
    const MAX_DEPTH = 10;
    const startTime = Date.now();
    lastYieldTime = startTime;

    console.log(`⏱️ トラディショナルAI 思考開始 (${TIME_LIMIT_MS/1000}秒制限)...`);
    let bestMoveFinal = validMoves[0];
    
    for (let currentDepth = 1; currentDepth <= MAX_DEPTH; currentDepth++) {
        let depthCompleted = true;
        let bestValAtThisDepth = -Infinity;
        let bestMoveAtThisDepth = validMoves[0];
        let alpha = -Infinity;
        let beta = Infinity;

        let scoredMoves = [];

        for (let move of validMoves) {
            if (Date.now() - startTime > TIME_LIMIT_MS) {
                depthCompleted = false;
                break;
            }

            const undo = makeMove(board, hands, move, owner);
            const val = -await evaluateMoveDeepTraditional(board, hands, 1 - owner, currentDepth - 1, startTime, TIME_LIMIT_MS, -beta, -alpha);
            undoMove(board, hands, undo);

            scoredMoves.push({ move, val });

            if (val > bestValAtThisDepth) {
                bestValAtThisDepth = val;
                bestMoveAtThisDepth = move;
            }
            if (bestValAtThisDepth > alpha) {
                alpha = bestValAtThisDepth;
            }
        }

        if (depthCompleted) {
            bestMoveFinal = bestMoveAtThisDepth;
            console.log(`✅ 深さ ${currentDepth} 完了: 評価値 ${bestValAtThisDepth}`);
            
            if (bestValAtThisDepth >= 9000) {
                console.log("💀 詰みを発見しました！");
                break; 
            }
            
            validMoves.sort((a, b) => {
                let sA = scoredMoves.find(m => m.move === a)?.val || -Infinity;
                let sB = scoredMoves.find(m => m.move === b)?.val || -Infinity;
                return sB - sA;
            });
        } else {
            console.log(`🚨 タイムアップ！深さ ${currentDepth-1} の結果を採用します。`);
            break;
        }
    }

    return bestMoveFinal;
}

// エクスポート
window.getBestMoveMebius = getBestMoveTraditional;
window.pieceValues = pieceValues;
window.evaluateBoard = evaluateBoard;
window.applyMove = applyMove;
window.makeMove = makeMove;
window.undoMove = undoMove;

if (window.afterEngineLoaded) window.afterEngineLoaded();

