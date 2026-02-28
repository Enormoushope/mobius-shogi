// ==============================================================================
// ui.js: 描画とユーザー操作、AIターンの呼び出し（棋譜機能・完全削除版）
// ==============================================================================
console.log = function() {};

const boardElement = document.getElementById('board');
const aiHandElement = document.getElementById('ai-hand');
const playerHandElement = document.getElementById('player-hand');
const outeMessage = document.getElementById('oute-message');
const gameOverModal = document.getElementById('game-over-modal');
const gameOverText = document.getElementById('game-over-text');

let currentPlayer = 0; // 0: あなた(Human), 1: AI
let selectedPiece = null;
let currentValidMoves = [];
let evalHistory = []; // 評価値グラフ用のデータ

// ==============================================================================
// --- ゲームの進行・終了管理 ---
// ==============================================================================

function resetGame() {
    gameOverModal.style.display = 'none';
    outeMessage.innerText = '';
    currentPlayer = 0;
    selectedPiece = null;
    evalHistory = [];
    window.gameState = 'playing';
    
    // game.js の初期化関数を呼ぶ
    if (typeof window.initBoard === 'function') window.initBoard();
    
    // 初期状態の評価値をグラフ用に記録
    if (typeof window.evaluateBoard === 'function') {
        evalHistory.push(window.evaluateBoard(window.boardState, window.capturedHands, 0));
    }
    
    drawBoard();
    updateGraphUI();
}

function endGame(message) {
    window.gameState = 'gameover';
    updateGraphUI(); // 最後にグラフを更新
    takeBoardSnapshot();
    // 🌟 修正：ブラウザが盤面を描画する時間を確保するため、0.1秒だけ遅らせてモーダルを出す
    setTimeout(() => {
        gameOverText.innerText = message;
        gameOverModal.style.display = 'block';
    }, 100);
}

// ==============================================================================
// --- 描画ロジック（盤面・持ち駒） ---
// ==============================================================================

function drawHands() {
    aiHandElement.innerHTML = 'AIの持ち駒: ';
    window.capturedHands[1].forEach((type) => {
        aiHandElement.innerHTML += `<span class="piece" style="color: white; text-shadow: 1px 1px 2px #000, -1px -1px 2px #000; transform: rotate(180deg); display: inline-block; margin: 0 2px;">${window.pieceNames[type][0]}</span>`;
    });

    playerHandElement.innerHTML = 'あなたの持ち駒: ';
    window.capturedHands[0].forEach((type, index) => {
        let span = document.createElement('span');
        span.className = 'piece';
        span.style.color = 'black';
        span.style.cursor = 'pointer';
        span.style.display = 'inline-block';
        span.style.margin = '0 2px';
        span.innerText = window.pieceNames[type][0];
        
        if (selectedPiece && selectedPiece.isHand && selectedPiece.index === index) {
            span.style.backgroundColor = '#ffeb3b';
        }

        span.addEventListener('click', () => {
            if (currentPlayer === 0 && window.gameState === 'playing') {
                selectedPiece = { isHand: true, type: type, index: index, owner: 0 };
                drawBoard();
            }
        });
        playerHandElement.appendChild(span);
    });
}

function drawBoard() {
    if (!boardElement) return;
    if (!window.boardState || window.boardState.length !== 9) {
        if (typeof window.initBoard === 'function') window.initBoard();
        else return;
    }
    
    // 🌟 修正：盤面を消す「前」に合法手を計算しておく（描画に使うため）
    if (currentPlayer === 0 && window.gameState !== 'gameover') {
        currentValidMoves = window.getValidMoves(window.boardState, window.capturedHands, 0);
    }

    boardElement.innerHTML = '';
    drawHands();

    // 選択された駒の移動可能マスをリストアップ
    let pathCells = [];
    if (selectedPiece && currentPlayer === 0) {
        if (selectedPiece.isHand) {
            currentValidMoves.forEach(m => {
                if (m.isHand && m.type === selectedPiece.type) pathCells.push({ x: m.endX, y: m.endY, rot: 0 });
            });
        } else {
            currentValidMoves.forEach(m => {
                if (!m.isHand && m.startX === selectedPiece.x && m.startY === selectedPiece.y) {
                    pathCells.push({ x: m.endX, y: m.endY, rot: m.rot });
                }
            });
        }
    }

    // 選択された駒が取れる敵駒の位置をリストアップ
    let capturablePositions = new Set();
    if (selectedPiece && !selectedPiece.isHand && currentPlayer === 0) {
        currentValidMoves.forEach(m => {
            if (!m.isHand && m.startX === selectedPiece.x && m.startY === selectedPiece.y) {
                const target = window.boardState[m.endY][m.endX];
                if (target && target.owner !== currentPlayer) capturablePositions.add(`${m.endX},${m.endY}`);
            }
        });
    }

    // 盤面の描画ループ
    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';

            const piece = window.boardState[y][x];
            const isPath = pathCells.some(p => p.x === x && p.y === y);

            if (isPath) cell.classList.add('path');
            if (selectedPiece && !selectedPiece.isHand && selectedPiece.x === x && selectedPiece.y === y) {
                cell.style.backgroundColor = '#ffeb3b'; // 選択中のマス
            }

            if (piece) {
                let pieceText = piece.isPromoted ? window.pieceNames[piece.type][1] : window.pieceNames[piece.type][0];
                let color = piece.owner === 1 ? 'white' : 'black';
                if (piece.isPromoted) color = piece.owner === 0 ? 'red' : '#0055ff';

                const span = document.createElement('span');
                span.className = 'piece' + (piece.isPromoted ? ' promoted' : '');
                span.style.transform = `rotate(${piece.rotation}deg)`;
                span.style.display = 'inline-block';
                span.style.color = color;
                if (piece.owner === 1) span.style.textShadow = '1px 1px 2px #000, -1px -1px 2px #000';
                
                const cellSize = Math.min(cell.clientWidth || 40, cell.clientHeight || 40);
                const fontRatio = piece.isPromoted ? 0.5 : 0.65;
                span.style.fontSize = Math.max(12, Math.floor(cellSize * fontRatio)) + 'px';
                span.innerText = pieceText;
                cell.appendChild(span);

                // 取れる駒に赤いドットを表示
                if (piece.owner !== currentPlayer && capturablePositions.has(`${x},${y}`)) {
                    cell.style.position = 'relative';
                    span.style.position = 'relative'; span.style.zIndex = '1';
                    const dot = document.createElement('span');
                    dot.style.cssText = 'position:absolute; width:14px; height:14px; border-radius:50%; background-color:red; left:50%; top:50%; transform:translate(-50%, -50%); box-shadow:0 0 4px rgba(0,0,0,0.6); pointer-events:none; z-index:2;';
                    cell.appendChild(dot);
                }
            }

            // マスクリック時の処理
            cell.addEventListener('click', (e) => {
                if (currentPlayer !== 0 || window.gameState === 'gameover') return;
                if (document.getElementById('move-selector-popup')) return; // ポップアップ中は無視

                if (isPath) {
                    let possibleMoves = [];
                    if (selectedPiece.isHand) {
                        possibleMoves = currentValidMoves.filter(m => m.isHand && m.type === selectedPiece.type && m.endX === x && m.endY === y);
                    } else {
                        possibleMoves = currentValidMoves.filter(m => !m.isHand && m.startX === selectedPiece.x && m.startY === selectedPiece.y && m.endX === x && m.endY === y);
                    }

                    if (possibleMoves.length > 1) {
                        showMoveSelector(possibleMoves, cell, x, y); 
                    } else if (possibleMoves.length === 1) {
                        executePlayerMove(possibleMoves[0], x, y);
                    } else {
                        selectedPiece = null; drawBoard();
                    }
                } else if (piece && piece.owner === 0) {
                    selectedPiece = { isHand: false, x: x, y: y, piece: piece };
                    drawBoard();
                } else {
                    selectedPiece = null;
                    drawBoard();
                }
            });
            boardElement.appendChild(cell);
        }
    }

    // 🌟 修正：すべての駒を描画し終わった「後」に、詰み判定を行う！
    if (currentPlayer === 0 && window.gameState !== 'gameover') {
        if (currentValidMoves.length === 0) {
            endGame(window.isCheck(window.boardState, 0) ? "詰みです... あなたの負け！💀" : "指し手がありません。引き分けです");
            return;
        }
        outeMessage.innerText = window.isCheck(window.boardState, 0) ? "⚠️ 王手されています！" : "";
    }
}

// ==============================================================================
// --- プレイヤーとAIのターン処理 ---
// ==============================================================================

// 成り/方向転換のポップアップ
function showMoveSelector(moves, cellElement, x, y) {
    let popup = document.createElement('div');
    popup.id = 'move-selector-popup';
    popup.style.cssText = 'position:absolute; z-index:100; background:rgba(255,255,255,0.95); border:2px solid #333; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.4); display:flex; flex-direction:column; padding:5px; top:50%; left:50%; transform:translate(-50%, -50%); width:max-content;';
    cellElement.style.position = 'relative';

    let uniqueOptions = [];
    let seen = new Set();

    moves.forEach(m => {
        let rotNorm = ((m.rot % 360) + 360) % 360;
        let status = m.isPromote ? "成" : (moves.some(x => x.isPromote) ? "不成" : "移動");
        let isRotateOnly = (m.startX === m.endX && m.startY === m.endY);
        let key = `${status}-${rotNorm}-${isRotateOnly}`;
        
        if (!seen.has(key)) {
            seen.add(key);
            uniqueOptions.push({ move: m, status: status, rotNorm: rotNorm, isRotateOnly: isRotateOnly });
        }
    });

    uniqueOptions.forEach(opt => {
        let btn = document.createElement('button');
        btn.style.cssText = 'margin:3px; padding:8px 12px; cursor:pointer; font-size:14px; font-weight:bold; border:1px solid #ccc; border-radius:4px; background:#f9f9f9; text-align:center;';
        let dirIcon = opt.rotNorm === 0 ? "↑" : opt.rotNorm === 90 ? "→" : opt.rotNorm === 180 ? "↓" : "←";
        btn.innerText = opt.isRotateOnly ? `向き変更 (${dirIcon})` : `${opt.status} (${dirIcon})`;
        
        btn.onmouseover = () => btn.style.background = '#e0f7fa';
        btn.onmouseout = () => btn.style.background = '#f9f9f9';

        btn.onclick = (e) => {
            e.stopPropagation(); 
            popup.remove();
            executePlayerMove(opt.move);
        };
        popup.appendChild(btn);
    });

    let closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'margin:3px; padding:4px; cursor:pointer; font-size:12px; background:#ffcdd2; border:1px solid #e57373; border-radius:4px;';
    closeBtn.innerText = 'キャンセル';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        popup.remove();
        selectedPiece = null; 
        drawBoard();
    };
    popup.appendChild(closeBtn);
    cellElement.appendChild(popup);
}

// プレイヤーの移動処理
function executePlayerMove(theMove) {
    if (typeof window.applyMove !== 'function') return alert('内部エラー: applyMove が見つかりません');
    
    if (theMove.isHand) {
        theMove.index = selectedPiece.index;
        window.applyMove(window.boardState, window.capturedHands, theMove, 0);
    } else {
        window.applyMove(window.boardState, window.capturedHands, theMove, 0, theMove.isPromote);
    }
    
    selectedPiece = null;
    currentPlayer = 1;

    // 千日手チェック（終わる場合も盤面を描画する）
    if (window.recordState && window.recordState(currentPlayer)) {
        drawBoard();
        return;
    }

    // 評価値の記録とグラフ更新
    if (window.evaluateBoard) {
        evalHistory.push(window.evaluateBoard(window.boardState, window.capturedHands, 0));
        updateGraphUI();
    }

    drawBoard(); // 自分の手を即座に画面に反映
    setTimeout(aiTurn, 100); // すぐにAIの思考を開始
}

// AIのターン処理
async function aiTurn() {
    if (window.gameState === 'gameover') return;
    
    const statusEl = document.getElementById('ai-status');
    if (statusEl) statusEl.innerText = "AI思考中... 🧠";

    let bestMoveFinal = null;
    try {
        if (typeof window.getBestMoveTraditional === 'function') {
            bestMoveFinal = await window.getBestMoveTraditional(window.boardState, window.capturedHands, 1);
        } else {
            console.error("🚨 engine.js が読み込まれていないか、getBestMoveTraditional がありません。");
            return;
        }
    } catch (e) {
        console.error("🚨 AIの思考中にエラー:", e);
    }

    // 投了判定
    if (!bestMoveFinal) {
        endGame("AIが投了しました。あなたの勝ちです！🎉");
        if (statusEl) statusEl.innerText = "";
        return;
    }

    if (statusEl) statusEl.innerText = "";

    // 盤面にAIの手を適用
    window.applyMove(window.boardState, window.capturedHands, bestMoveFinal, 1, bestMoveFinal.isPromote);
    
    currentPlayer = 0; // プレイヤーのターンに戻す
    
    // 千日手チェック（終わる場合も盤面を描画する）
    if (window.recordState && window.recordState(currentPlayer)) {
        drawBoard();
        return; 
    }
    
    // 評価値の記録とグラフ更新
    if (window.evaluateBoard) {
        evalHistory.push(window.evaluateBoard(window.boardState, window.capturedHands, 0));
        updateGraphUI();
    }
    
    drawBoard(); // AIの手を画面に反映
}

// ==============================================================================
// --- 評価値グラフ関連 ---
// ==============================================================================

// 終局時の盤面を snapshot-canvas に描き出す関数
function takeBoardSnapshot() {
    const canvas = document.getElementById('snapshot-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cellSize = canvas.width / 9;

    // 1. 背景（盤の色）
    ctx.fillStyle = "#f3c952"; // 将棋盤らしい色
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. 罫線
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 9; i++) {
        const pos = i * cellSize;
        // 縦線
        ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, canvas.height); ctx.stroke();
        // 横線
        ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(canvas.width, pos); ctx.stroke();
    }

    // 3. 駒の描画
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            const piece = window.boardState[y][x];
            if (piece) {
                const px = x * cellSize + cellSize / 2;
                const py = y * cellSize + cellSize / 2;

                ctx.save();
                ctx.translate(px, py);
                // 🌟 特殊ルール：駒の向き(rotation)を反映
                ctx.rotate((piece.rotation * Math.PI) / 180);

                // 文字色（成り駒なら赤、AIなら青っぽい白など）
                let color = piece.owner === 0 ? "black" : "white";
                if (piece.isPromoted) color = piece.owner === 0 ? "red" : "#0055ff";
                
                ctx.fillStyle = color;
                if (piece.owner === 1) { ctx.shadowColor = "black"; ctx.shadowBlur = 3; }
                
                ctx.font = `bold ${cellSize * 0.7}px sans-serif`;
                const text = piece.isPromoted ? window.pieceNames[piece.type][1] : window.pieceNames[piece.type][0];
                ctx.fillText(text, 0, 0);
                ctx.restore();
            }
        }
    }
}

function updateGraphUI() {
    const evalCanvas = document.getElementById('eval-canvas');
    if (evalCanvas) {
        drawEvalGraph(evalCanvas, evalHistory);
    }
}

function drawEvalGraph(canvas, evals) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (!evals || evals.length === 0) return;
    
    const w = canvas.width, h = canvas.height;
    const margin = 10;
    
    let maxv = Math.max(...evals.map(Math.abs));
    if (maxv < 1000) maxv = 1000;

    // 中央の線（0点）
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(margin, h/2); ctx.lineTo(w-margin, h/2); ctx.stroke();

    // グラフの線
    ctx.strokeStyle = '#0077cc'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i=0; i<evals.length; i++) {
        const x = margin + (w-2*margin) * (i/(evals.length-1 || 1));
        const y = h/2 - (evals[i]/maxv) * (h/2 - margin);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    // 🌟 修正：グラフに手数と評価値のテキストを大きく表示する
    const latestIndex = evals.length - 1;
    const latestEval = evals[latestIndex];
    
    let evalText = latestEval;
    if (latestEval > 9000) evalText = "詰み (AI有利)";
    else if (latestEval < -9000) evalText = "詰み (あなた有利)";
    else if (latestEval > 0) evalText = "+" + latestEval;

    // 文字のスタイル
    ctx.fillStyle = latestEval >= 0 ? '#ff4444' : '#4444ff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    // グラフの右上にテキストを描画
    const textPadding = 10;
    ctx.fillText(`手数: ${latestIndex} 手`, w - textPadding, textPadding);
}

// ==============================================================================
// --- 初期化イベント ---
// ==============================================================================

window.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('btn-start-game');
    const startupScreen = document.getElementById('startup-screen');

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (startupScreen) startupScreen.style.display = 'none';
            resetGame(); // ゲーム開始
        });
    } else {
        resetGame();
    }
});

window.resetGame = resetGame;
window.endGame = endGame;
window.drawBoard = drawBoard;
window.aiTurn = aiTurn;