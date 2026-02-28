// script.js is now a stub: UI and logic are modularized into game.js, engine.js, ui.js
// Left intentionally minimal to avoid accidental duplicate definitions.
console.log('script.js loaded (stub)');

// 棋譜を記録する配列（グローバル）
window.gameHistory = [];
window.turnCount = 0; // 手数カウンタ（1手ごとにインクリメント）

function findKing(board, owner) {
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) 
        if (board[y][x] && board[y][x].type === 'king' && board[y][x].owner === owner) return {x, y};
    return null;
}

function inAura(x, y, kingPos) {
    if (!kingPos) return false;
    return Math.abs(x - kingPos.x) <= 2 && Math.abs(y - kingPos.y) <= 2;
}

// script.js stub (module files handle logic/ui)
console.log('script.js stub');
    for (let y=0;y<9;y++){
        for (let x=0;x<9;x++){
            ctx.strokeRect(x*cell, y*cell, cell, cell);
            let p = board[y][x];
            if (p) {
                let t = p.isPromoted ? pieceNames[p.type][1] : pieceNames[p.type][0];
                ctx.fillStyle = p.owner===1 ? '#222' : '#000';
                ctx.save();
                if (p.owner===1) { ctx.translate((x+0.5)*cell, (y+0.5)*cell); ctx.rotate(Math.PI); ctx.fillText(t, 0, 0); ctx.restore(); }
                else { ctx.fillText(t, (x+0.5)*cell, (y+0.5)*cell); }
            }
        }
    }


// 単純な評価値グラフ描画
function drawEvalGraph(canvas, data) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (!data || data.length === 0) return;
    const w = canvas.width, h = canvas.height, pad = 20;
    const minV = Math.min(...data), maxV = Math.max(...data);
    const range = (maxV - minV) || 1;
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.strokeRect(0,0,w,h);
    ctx.beginPath();
    data.forEach((v,i) => {
        const x = pad + (w-2*pad)*(i/(data.length-1 || 1));
        const y = pad + (h-2*pad)*(1 - (v - minV)/range);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = '#0077cc'; ctx.lineWidth = 2; ctx.stroke();
    // 軸ラベル
    ctx.fillStyle = '#000'; ctx.font = '12px sans-serif';
    ctx.fillText(Math.round(maxV), 4, pad+6);
    ctx.fillText(Math.round(minV), 4, h-pad);
}