/* Production-pilot bridge. Offline file:// mode retains the explicitly fictional V6 demo. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let enabled=false,csrf='',account=null;
async function request(method,url,body){
  const opts={method,credentials:'same-origin',headers:{'Accept':'application/json'}};
  if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}
  if(!['GET','HEAD'].includes(method))opts.headers['X-CSRF-Token']=csrf;
  const res=await fetch(url,opts);
  let data={};try{data=await res.json()}catch{}
  if(!res.ok)throw new Error(typeof data.detail==='string'?data.detail:`Request failed (${res.status})`);
  return data;
}
const closeLogin=()=>{$('login-backdrop').hidden=true};
function openLogin(){
 $('login-backdrop').hidden=false;
 $('login-form').hidden=!!account;
 $('account-panel').hidden=!account;
 $('login-status').textContent='';
 if(account){$('account-status').textContent=`Signed in as ${account.display_name} (${account.role}). ${account.must_change_password?'Change your initial password to unlock editing.':''}`}
 else $('login-username').focus();
}
async function refreshMe(){
 try{const data=await request('GET','/api/me');account=data.user;csrf=data.csrf;window.ArenaV6.setSavedAvatar(account.avatar);$('account-entry').textContent=account.display_name.slice(0,12).toUpperCase();document.querySelector('.studio-namebar strong').textContent=account.display_name.toUpperCase();$('save-character').textContent='SAVE MY CHARACTER ↗'}
 catch{account=null;csrf='';$('account-entry').textContent='SIGN IN';document.querySelector('.studio-namebar strong').textContent='GUEST · PREVIEW';$('save-character').textContent='SIGN IN TO SAVE ↗'}
}
async function loadCatalog(){
 if(!enabled)return;
 const level=$('level-filter').value,semester=$('semester-filter').value;
 try{
  const d=await request('GET',`/api/catalog?level=${level}&semester=${semester}`);
  const cohort=$('group-filter');const prev=cohort.value;cohort.replaceChildren();
  for(const key of d.groups){const o=new Option(key.replaceAll('_',' '),key);cohort.add(o)}
  if(d.groups.includes(prev))cohort.value=prev;
  if(!d.groups.length)cohort.add(new Option('No approved cohort yet','core'));
  const m=$('module-filter');const prior=m.value;m.replaceChildren();
  for(const key of (d.modules[cohort.value]||[]))m.add(new Option(key,key));
  if(Array.from(m.options).some(o=>o.value===prior))m.value=prior;
  if(!m.options.length)m.add(new Option('No published module','none'));
 }catch(e){console.warn('Catalog unavailable',e.message)}
}
async function loadBoards(){
 if(!enabled)return;
 const x=window.ArenaV6.filters();
 const key=x.mode==='module'?x.module:'all';
 try{const data=await request('GET',`/api/boards?level=${encodeURIComponent(x.level)}&semester=${encodeURIComponent(x.semester)}&board_kind=${x.mode}&board_key=${key}&group_key=${encodeURIComponent(x.group)}`);
 window.ArenaV6.setRows(data.rows.map(x=>({name:x.name,avatar:x.avatar,style:x.style})));}
 catch(e){window.ArenaV6.setRows([]);console.warn('Leaderboard not available:',e.message)}
}
async function loadWins(){
 if(!enabled)return;
 try{let data=await request('GET','/api/wins');window.ArenaV6PublicWins=data.posts;window.ArenaV6.renderWins();}catch(e){console.warn('Feed not available',e.message)}
}
async function saveAvatar(avatar){
 if(!account){openLogin();window.ArenaV6.status('Sign in to save your character.');return}
 if(account.must_change_password){openLogin();window.ArenaV6.status('Change your initial password first.');return}
 try{await request('PUT','/api/me/avatar',avatar);window.ArenaV6.setSavedAvatar(avatar);window.ArenaV6.status('Your character has been saved to your staff-issued account.');await loadBoards()}
 catch(e){window.ArenaV6.status(e.message)}
}
async function react(id,kind){
 if(!account){openLogin();return}
 try{await request('PUT',`/api/wins/${encodeURIComponent(id)}/reaction`,{kind});await loadWins()}
 catch(e){alert(e.message)}
}
async function postWin(data){
 if(!account){openLogin();return}
 try{const result=await request('POST','/api/wins',data);$('composer-backdrop').hidden=true;$('achievement-form').reset();$('pending-description').textContent='Your achievement is pending staff approval. It will not appear publicly until reviewed.';$('pending-panel').hidden=false;$('approve-demo').hidden=true;await loadStaffQueue()}
 catch(e){$('composer-status').textContent=e.message}
}
async function loadStaffQueue(){
 const old=$('moderation-live');if(old)old.remove();
 if(!account||!['admin','staff'].includes(account.role))return;
 try{
  const data=await request('GET','/api/staff/pending');
  const panel=document.createElement('section');panel.id='moderation-live';panel.className='pending-panel';
  const h=document.createElement('h3');h.textContent=`STAFF REVIEW · ${data.posts.length} PENDING`;panel.append(h);
  for(const post of data.posts){const item=document.createElement('div');item.style.padding='10px 0';item.style.borderBottom='1px solid #aaa';const txt=document.createElement('p');txt.textContent=`${post.author}: ${post.type} — ${post.note}`;item.append(txt);for(const decision of ['approved','rejected']){const button=document.createElement('button');button.className='outline-btn';button.style.marginRight='8px';button.textContent=decision==='approved'?'APPROVE':'REJECT';button.addEventListener('click',async()=>{try{await request('POST',`/api/staff/wins/${post.id}/decision`,{decision});await loadStaffQueue();await loadWins()}catch(e){alert(e.message)}});item.append(button)}panel.append(item)}
  $('wins-feed').before(panel);
 }catch(e){console.warn('Moderation queue unavailable',e.message)}
}
$('account-entry').addEventListener('click',()=>enabled?openLogin():alert('Offline demonstration: real staff-issued accounts are available when running the included pilot server.'));
$('close-login').addEventListener('click',closeLogin);
$('login-backdrop').addEventListener('click',e=>{if(e.target===$('login-backdrop'))closeLogin()});
$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();
 if(!enabled)return;
 try{const r=await request('POST','/api/auth/login',{username:$('login-username').value,password:$('login-password').value});csrf=r.csrf;account=r.user;$('login-password').value='';await refreshMe();if(account.must_change_password)openLogin();else closeLogin();await loadBoards();await loadStaffQueue()}
 catch(error){$('login-status').textContent=error.message}
});
$('change-password-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!enabled)return;
 try{await request('POST','/api/me/password',{old_password:$('old-password').value,new_password:$('new-password').value});$('old-password').value='';$('new-password').value='';await refreshMe();closeLogin()}
 catch(error){$('account-status').textContent=error.message}
});
$('logout-btn').addEventListener('click',async()=>{try{await request('POST','/api/auth/logout');account=null;csrf='';$('account-entry').textContent='SIGN IN';document.querySelector('.studio-namebar strong').textContent='GUEST · PREVIEW';$('save-character').textContent='SIGN IN TO SAVE ↗';closeLogin();await loadBoards()}catch(e){$('account-status').textContent=e.message}});
$('achievement-form').addEventListener('submit',e=>{
 if(!enabled)return;
 e.preventDefault();e.stopImmediatePropagation();
 postWin({type:$('achievement-type').value,note:$('achievement-note').value.trim()});
},true);
$('open-composer').addEventListener('click',e=>{
 if(!enabled)return;
 if(!account){e.preventDefault();e.stopImmediatePropagation();$('composer-backdrop').hidden=true;openLogin()}
},true);
document.addEventListener('arena-board-change',async()=>{await loadCatalog();await loadBoards()});$('group-filter').addEventListener('change',async()=>{await loadCatalog();await loadBoards()});
document.querySelectorAll('.nav-link[data-page="wins"]').forEach(el=>el.addEventListener('click',loadStaffQueue));
window.ArenaV6Server={saveAvatar,react};
(async()=>{
 if(location.protocol==='file:'){window.ArenaV6Server=null;return}
 try{const r=await fetch('/api/config',{credentials:'same-origin'});if(!r.ok||!(r.headers.get('content-type')||'').includes('application/json'))throw Error('No pilot backend');let c=await r.json();if(c.mode!=='server')throw Error('No pilot backend');}
 catch{window.ArenaV6Server=null;return}
 enabled=true;
 document.querySelector('.demo-stamp').textContent='PILOT';document.querySelector('.sheet-footer').textContent='Only institutionally approved public names and ranking positions are shown. No grades, raw attendance or Academic Scores.';document.querySelector('.illustration-credit').textContent='Server-backed pilot. Approved publications only. Account data and public rankings are subject to university IT and privacy review.';document.querySelector('.save-note').textContent='Account holders can save their assigned avatar. Guest visitors can preview characters without saving.';
 const footer=document.querySelector('.wins-guardrail');if(footer)footer.textContent='Public approved achievements only · posting and reactions require a student account · no comments';
 await refreshMe();await loadCatalog();await Promise.all([loadBoards(),loadWins()]);await loadStaffQueue();
})();
})();
