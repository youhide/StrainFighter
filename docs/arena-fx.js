const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// X follows the gap between the fighters. Y follows the sprite height.
export const moves = {
  lemon: {
    normal: { name:'Corte Cítrico', color:'#e2f875', style:'cut', hit:190, duration:405, frames:[
      [0,0,0,0,1], [.22,-.12,.04,-9,1], [.48,.83,-.06,13,1.05], [.66,.59,-.01,4,1], [1,0,0,0,1],
    ] },
    special: { name:'Raio Limão', color:'#e9ff93', style:'bolt', hit:320, duration:620, frames:[
      [0,0,0,0,1], [.25,-.16,-.05,-14,1.11], [.49,.96,-.13,15,1.15], [.66,.72,-.02,6,1], [1,0,0,0,1],
    ] },
  },
  violet: {
    normal: { name:'Ombro Roxo', color:'#d696ff', style:'slam', hit:260, duration:510, frames:[
      [0,0,0,0,1], [.25,-.08,.11,-12,1.02], [.53,.82,.03,15,1.18], [.72,.52,.05,7,1.07], [1,0,0,0,1],
    ] },
    special: { name:'Abalo Violeta', color:'#f397fc', style:'quake', hit:425, duration:780, frames:[
      [0,0,0,0,1], [.21,.16,-.18,-8,1.09], [.42,.71,-.49,-17,1.17], [.55,.9,.02,12,1.14],
      [.71,.64,.075,3,1.04], [1,0,0,0,1],
    ] },
  },
  mango: {
    normal: { name:'Chute Solar', color:'#ffba61', style:'kick', hit:250, duration:485, frames:[
      [0,0,0,0,1], [.19,-.06,.045,-12,.97], [.52,.81,-.25,-24,1.11], [.70,.56,-.14,8,1], [1,0,0,0,1],
    ] },
    special: { name:'Vórtice Solar', color:'#ffab62', style:'vortex', hit:365, duration:720, frames:[
      [0,0,0,0,1], [.2,-.10,-.11,-16,1.02], [.39,.50,-.35,-32,1.10], [.52,.91,-.30,36,1.18],
      [.75,.52,-.1,-11,1.06], [1,0,0,0,1],
    ] },
  },
};

const clamp = n => Math.max(0,Math.min(1,n));
const tween = (a,b,p) => a+(b-a)*p;

export function createArenaEffects(arena) {
  const canvas = arena.querySelector('canvas');
  const context = canvas.getContext('2d');
  const player = arena.querySelector('#player-sprite');
  const rival = arena.querySelector('#rival-sprite');
  const label = arena.querySelector('#attack-call');
  let frame;
  let labelTimer;
  let animations = [];

  function clear() {
    cancelAnimationFrame(frame);
    clearTimeout(labelTimer);
    for (const animation of animations) animation.cancel();
    animations = [];
    context?.clearRect(0,0,canvas.width,canvas.height);
    label.hidden = true;
  }

  function play(fighter, special, name, defeated) {
    const move = moves[fighter][special?'special':'normal'];
    clear();
    label.style.setProperty('--attack-color',move.color);
    label.textContent = name;
    label.hidden = false;
    labelTimer = setTimeout(() => { label.hidden = true; },special?820:470);
    if (reducedMotion.matches) {
      if (defeated) rival.classList.add('defeated');
      return;
    }

    const bounds = arena.getBoundingClientRect();
    const source = player.getBoundingClientRect();
    const enemy = rival.getBoundingClientRect();
    const from = {x:source.left-bounds.left+source.width*.66,y:source.top-bounds.top+source.height*.5};
    const target = {x:enemy.left-bounds.left+enemy.width*.31,y:enemy.top-bounds.top+enemy.height*.53};
    const gap = Math.max(source.width*.29,target.x-from.x);
    animations.push(player.animate(move.frames.map(([offset,x,y,angle,size]) => ({
      offset, transform:`translate(${x*gap}px,${y*source.height}px) rotate(${angle}deg) scale(${size})`,
    })),{duration:move.duration,easing:'linear'}));

    if (context) {
      const pixelRatio = Math.min(devicePixelRatio,1.5);
      const width = Math.round(bounds.width*pixelRatio);
      const height = Math.round(bounds.height*pixelRatio);
      if (canvas.width!==width || canvas.height!==height) {
        canvas.width=width;
        canvas.height=height;
      }
      context.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    }
    const began = performance.now();
    let landed = false;
    function draw(time) {
      const elapsed = time-began;
      if (elapsed >= move.hit && !landed) {
        landed = true;
        if (defeated) rival.classList.add('defeated');
        else animations.push(rival.animate([
          {transform:'translateX(0)'},
          {offset:.24,transform:`translateX(-${special?14:6}%) rotate(-${special?13:5}deg) scale(.92,1.08)`},
          {transform:'translateX(0)'},
        ],{duration:special?295:205,easing:'ease-out'}));
      }
      if (context) {
        context.clearRect(0,0,bounds.width,bounds.height);
        paintMove(context,move,from,target,elapsed,Math.max(.55,bounds.width/940));
      }
      if (elapsed < move.hit+340) frame=requestAnimationFrame(draw);
      else context?.clearRect(0,0,bounds.width,bounds.height);
    }
    frame=requestAnimationFrame(draw);
  }
  reducedMotion.addEventListener('change',clear);
  return { clear, play };
}

function paintMove(ctx,move,from,target,elapsed,scale) {
  const age = elapsed-move.hit;
  const p = clamp(age/340);
  const approach = clamp((age+155)/155);
  const power = ['bolt','quake','vortex'].includes(move.style);
  const size = (power?1.55:1)*scale;
  if (age < -155 || age > 340) return;
  ctx.save();
  ctx.fillStyle=ctx.strokeStyle=move.color;
  ctx.lineCap='round';
  ctx.lineWidth=3.5*size;
  if (move.style==='bolt' && age<115) {
    ctx.globalAlpha=age<0?approach:1-age/115;
    ctx.beginPath();
    ctx.moveTo(from.x,from.y);
    for(let i=1;i<=9;i++) {
      const step=i/9;
      ctx.lineTo(tween(from.x,target.x,step),tween(from.y,target.y,step)+(i===9?0:Math.sin(i*2.7+elapsed*.09)*22*scale));
    }
    ctx.stroke();
  }
  if (move.style==='vortex' || move.style==='kick' || move.style==='cut') {
    ctx.globalAlpha=age<0?approach*.8:(1-p)*.85;
    const centerX=age<0?tween(from.x,target.x,approach):target.x;
    for(let i=0;i<(move.style==='vortex'?3:1);i++) {
      ctx.beginPath();
      ctx.ellipse(centerX,target.y-i*14*scale,(28+i*9)*size,(move.style==='cut'?10:17)*size,-.62+i*.46,approach*2-2.8,approach*2+.5);
      ctx.stroke();
    }
  }
  if (age>=0) {
    ctx.globalAlpha=(1-p)*.95;
    if (move.style==='slam' || move.style==='quake') {
      for(let i=0;i<(power?3:1);i++) {
        ctx.beginPath();
        ctx.ellipse(target.x,target.y+34*scale,(11+53*p+i*9)*size,(3+17*p+i*3)*size,0,0,Math.PI*2);
        ctx.stroke();
      }
    }
    for(let i=0;i<(power?13:7);i++) {
      const angle=i*2.4;
      const distance=(9+p*(29+(i%4)*8))*size;
      const x=target.x+Math.cos(angle)*distance;
      const y=target.y+Math.sin(angle)*distance;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+Math.cos(angle)*9*size*(1-p),y+Math.sin(angle)*9*size*(1-p));
      ctx.stroke();
    }
  }
  ctx.restore();
}
