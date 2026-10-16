/* ShiftPro NOVA assistant: local-first, allow-listed actions; API remains optional. */
(function (global) {
  'use strict';
  const ENDPOINT_KEY='shiftpro_ai_endpoint', LOCAL_KEY='shiftpro_codecraft_api_key';
  const DEFAULT_ENDPOINT='https://YOUR-WORKER.workers.dev/api/assistant';
  const CODECRAFT_URL='https://codecraftapi.com/v1/chat/completions', CODECRAFT_MODEL='claude-opus-4.8';
  const MAX_MESSAGE=2000;
  let busy=false, nudgeTimer=null, nudgeIndex=0, voiceReplies=false, recognition=null;
  const locale=()=>global.SPi18n?global.SPi18n.getLocale():'ar';
  const isAr=()=>locale()!=='en';
  const tr=(ar,en)=>isAr()?ar:en;
  const workerName=()=>{
    const el=document.getElementById('workerName')||document.getElementById('heroName');
    const name=(el?.textContent||'').trim();
    return !name||name==='—' ? tr('صديقي','there') : name;
  };
  function getEndpoint(){try{return(localStorage.getItem(ENDPOINT_KEY)||DEFAULT_ENDPOINT).trim()}catch(_){return DEFAULT_ENDPOINT}}
  function getLocalApiKey(){try{return(localStorage.getItem(LOCAL_KEY)||'').trim()}catch(_){return ''}}
  function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  function speakText(text){
    if(!voiceReplies||!global.speechSynthesis||!global.SpeechSynthesisUtterance)return;
    try{global.speechSynthesis.cancel();const utterance=new global.SpeechSynthesisUtterance(String(text).slice(0,1800));utterance.lang=isAr()?'ar-EG':'en-US';utterance.rate=1;global.speechSynthesis.speak(utterance)}catch(_){}
  }
  function addMessage(list,role,text){const row=make('div','sp-ai-message '+(role==='user'?'is-user':'is-assistant'),text);row.setAttribute('role','listitem');list.appendChild(row);list.scrollTop=list.scrollHeight;if(role!=='user')speakText(text);return row}
  function setBusy(value,send,input){busy=value;send.disabled=value;input.disabled=value;send.textContent=value?'…':tr('إرسال','Send')}
  function openPanel(panel,input){panel.hidden=false;panel.classList.add('is-open');input.focus()}
  function closePanel(panel,launcher){panel.classList.remove('is-open');panel.hidden=true;launcher.focus()}
  function normalize(s){return String(s||'').toLocaleLowerCase().replace(/[أإآ]/g,'ا').replace(/[ى]/g,'ي').replace(/[ة]/g,'ه').trim()}
  function clickNav(tab){
    const selectors=[
      '[data-nav="'+tab+'"]','[data-tab-target="'+tab+'"]','[data-page="'+tab+'"]',
      '.nav-item[data-tab="'+tab+'"]','.tab-btn[data-tab="'+tab+'"]',
      'button[data-tab="'+tab+'"]','a[href="#page-'+tab+'"]','button[aria-controls="page-'+tab+'"]'
    ];
    for(const selector of selectors){const el=document.querySelector(selector);if(el){el.click();return true}}
    const aliases={dashboard:['الرئيسيه','الرئيسية','home','dashboard'],calendar:['التقويم','الورديات','calendar'],salary:['الراتب','الرواتب','salary'],reports:['التقارير','reports'],settings:['المزيد','الاعدادات','البيانات الشخصية','settings'],wallet:['المحافظ','المحفظه','wallet']};
    const candidates=[...document.querySelectorAll('nav button, nav a, .bottom-nav button, .bottom-nav a, .nav button, .nav a, [role="tab"]')];
    const found=candidates.find(el=>{const t=normalize((el.innerText||'')+' '+(el.getAttribute('aria-label')||''));return (aliases[tab]||[]).some(a=>t.includes(normalize(a)))});
    if(found){found.click();return true}
    const page=document.getElementById('page-'+tab);
    if(page){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p===page));return true}
    return false;
  }
  function lawAnswer(message){
    const law=global.__LAW__;
    if(!law||!Array.isArray(law.books))return null;
    const m=normalize(message);
    const lawIntent=/(قانون العمل|ماده|مواد القانون|اجازه|الاجازات|اجازات|الاجازة|اجازات|فصل تعسفي|فصل من العمل|استقاله|عقد العمل|ساعات العمل|ساعات الشغل|فتره الراحه|الراحه الاسبوعيه|الاجر|الاجور|الحد الادني|مكافاه نهايه الخدمه|التامينات|تعويض|تشغيل العمال|اجازة|الإجازة|المرضي|المرضيه|annual leave|labor law|labour law|employment contract|working hours|overtime|severance|dismissal|resignation|wages?)/i;
    if(!lawIntent.test(m))return null;
    const records=[];
    (law.preamble||[]).forEach(item=>{
      const body=Array.isArray(item.text)?item.text.join(' '):String(item.text||'');
      records.push({title:item.title||'مواد الإصدار',body,kind:'preamble'});
    });
    function addArticles(items,bookName,chapterName,sectionName){
      (items||[]).forEach(item=>{
        const paras=item.paras||item.text||item.content||[];
        const body=Array.isArray(paras)?paras.join(' '):String(paras||'');
        if(body)records.push({title:'المادة '+(item.num??item.number??item.title??''),body,bookName,chapterName,sectionName,num:item.num??item.number});
      });
    }
    (law.books||[]).forEach(book=>{
      addArticles(book.articles,book.name||book.title,'','');
      (book.chapters||[]).forEach(chapter=>{
        addArticles(chapter.articles,book.name||book.title,chapter.name||chapter.label,'');
        (chapter.sections||[]).forEach(section=>{
          addArticles(section.articles,book.name||book.title,chapter.name||chapter.label,section.name||section.label);
        });
      });
    });
    const stop=new Set(['في','من','على','عن','الى','الي','هل','ما','هو','هي','ايه','اي','كم','كيف','متى','ماذا','هل','قانون','العمل','المصري','المصريه','ماده','الماده','مواد','بخصوص','حسب','طبقا','وفقا','the','what','is','are','how','can','i','my','in','of','to','for','egyptian','labor','labour','law']);
    const tokens=m.split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>1&&!stop.has(t));
    if(!tokens.length)return tr('اكتب موضوعًا محددًا أو رقم المادة التي تريد البحث عنها في قانون العمل.','Ask about a specific labor-law topic or provide an article number.');
    const ranked=records.map(rec=>{
      const text=normalize(rec.title+' '+rec.body+' '+(rec.bookName||'')+' '+(rec.chapterName||'')+' '+(rec.sectionName||''));
      let score=0;
      tokens.forEach(token=>{if(text.includes(token))score+=token.length>4?2:1});
      const numMatch=m.match(/(?:الماده|ماده|article)\s*(\d+)/i);
      if(numMatch&&String(rec.num||'')===numMatch[1])score+=20;
      return {...rec,score};
    }).filter(x=>x.score>0).sort((x,y)=>y.score-x.score).slice(0,3);
    if(!ranked.length)return tr('ملقتش مادة واضحة مطابقة لسؤالك في نسخة القانون الموجودة بالتطبيق. جرّب كلمات أدق أو رقم المادة، ومش هخمن إجابة قانونية من غير نص مناسب.','I could not find a clear matching provision in the law text bundled with the app. Try more specific keywords or an article number; I will not guess a legal answer without a matching source.');
    const heading=tr('نتائج من نص قانون العمل المصري رقم 14 لسنة 2025:','Results from the Egyptian Labor Law No. 14 of 2025:');
    const results=ranked.map(rec=>{
      const snippet=rec.body.length>650?rec.body.slice(0,647).trim()+'…':rec.body;
      const meta=[rec.bookName,rec.chapterName,rec.sectionName].filter(Boolean).join(' — ');
      return (rec.title||tr('نص قانوني','Legal text'))+(meta?' ('+meta+')':'')+'\n'+snippet;
    });
    return heading+'\n\n'+results.join('\n\n')+'\n\n'+tr('تنبيه: ده استرجاع من النص المرفق بالتطبيق وليس استشارة قانونية. راجع النص الكامل والسياق والتعديلات الرسمية قبل اتخاذ قرار.','Note: This is retrieval from the law text bundled with the app, not legal advice. Check the full provision, context, and official amendments before acting.');
  }
  function localAction(message){
    const m=normalize(message);
    const openWords=['افتح','روح','انتقل','اعرض','اذهب','open','go to','show','view'];
    const navMap=[
      {tab:'dashboard',words:['الرئيسيه','الرئيسية','الصفحه الرئيسيه','home','dashboard']},
      {tab:'calendar',words:['التقويم','الورديات','الجدول','calendar','shifts']},
      {tab:'salary',words:['الراتب','الرواتب','salary','payroll']},
      {tab:'reports',words:['التقارير','التقرير','reports','report']},
      {tab:'settings',words:['المزيد','الاعدادات','البيانات الشخصيه','settings','profile']},
      {tab:'wallet',words:['المحافظ','المحفظه','wallet','wallets']}
    ];
    const isNavigation=openWords.some(w=>m.includes(normalize(w)))||navMap.some(x=>x.words.some(w=>m===normalize(w)));
    if(isNavigation){
      const target=navMap.find(x=>x.words.some(w=>m.includes(normalize(w))));
      if(target){
        if(clickNav(target.tab))return tr('تمام يا '+workerName()+' فتحت لك القسم المطلوب','Done, '+workerName()+'. I opened the requested section.');
        if(target.tab==='wallet')return tr('مش لاقي زر المحافظ في الواجهة الحالية. افتح قسم المحافظ من القائمة لو موجود.','I could not find a Wallets entry in the current navigation.');
        return tr('مش قادر أوصل للقسم ده من عناصر التنقل الحالية.','I could not locate that section in the current navigation.');
      }
    }
    if(m.includes('تسجيل حضور')||m.includes('check in')||m.includes('check-in')){
      const b=document.getElementById('checkinBtn');
      if(!b||b.disabled||b.hidden)return tr('زر تسجيل الحضور مش متاح حاليًا.','Check-in is not available right now.');
      if(global.confirm(tr('تأكيد تسجيل الحضور الآن يا '+workerName()+'؟','Confirm check-in now, '+workerName()+'?'))){b.click();return tr('نفذت طلب تسجيل الحضور. راجع حالة اليوم للتأكد.','I triggered check-in. Please verify today’s status.')}
      return tr('تمام، ألغيت تسجيل الحضور.','Okay, check-in was cancelled.');
    }
    if(m.includes('تسجيل انصراف')||m.includes('انصرف')||m.includes('check out')||m.includes('checkout')){
      const b=document.getElementById('checkoutBtn');
      if(!b||b.disabled||b.hidden)return tr('زر تسجيل الانصراف مش متاح حاليًا.','Check-out is not available right now.');
      if(global.confirm(tr('تأكيد تسجيل الانصراف الآن يا '+workerName()+'؟','Confirm check-out now, '+workerName()+'?'))){b.click();return tr('نفذت طلب تسجيل الانصراف. راجع الساعات المسجلة.','I triggered check-out. Please verify the recorded hours.')}
      return tr('تمام، ألغيت تسجيل الانصراف.','Okay, check-out was cancelled.');
    }
    if(m.includes('ملخص')||m.includes('summary')||m.includes('راتبي')||m.includes('my salary')){
      const ids=[['إجمالي الساعات','pHours'],['الراتب المستحق','dueSalary'],['إجمالي المستحق','pGrossSalary'],['الخصومات','pDeduction'],['ساعات اليوم','todayHours']];
      const lines=ids.map(([label,id])=>{const e=document.getElementById(id);return e?label+': '+e.textContent.trim():''}).filter(Boolean);
      if(lines.length)return tr('ده الملخص الظاهر في التطبيق حاليًا:\n','Here is the summary currently shown in the app:\n')+lines.join('\n');
    }
    if(m.includes('مساعده')||m.includes('help')||m.includes('تقدر تعمل ايه')||m.includes('ماذا تستطيع')){
      return tr('أقدر أفتح لك الأقسام وأعرض ملخص البيانات الظاهرة وأساعدك في تسجيل الحضور أو الانصراف بعد التأكيد. جرّب: افتح التقارير، افتح الراتب، اعرض ملخص راتبي، أو سجّل حضور. هضيف أوامر محلية لباقي الوظائف حسب دوال التطبيق الفعلية.','I can navigate sections, summarize visible data, and trigger check-in/check-out after confirmation. Try: open reports, open salary, summarize my salary, or check in. More local actions can be added against the app’s actual functions.');
    }
    return null;
  }
  function init(){
    if(document.getElementById('spAiLauncher'))return;
    const launcher=make('button','sp-ai-launcher');
    launcher.id='spAiLauncher';launcher.type='button';
    launcher.setAttribute('aria-label',tr('افتح نوفا مساعد ShiftPro','Open NOVA, the ShiftPro assistant'));
    launcher.title=tr('نوفا — مساعد ShiftPro','NOVA — ShiftPro assistant');
    launcher.innerHTML='<svg class="sp-ai-robot" viewBox="0 0 64 64" aria-hidden="true"><path class="robot-antenna" d="M32 8v7"/><circle cx="32" cy="6" r="3"/><rect x="11" y="17" width="42" height="34" rx="12"/><path class="robot-ear" d="M7 29v10m50-10v10"/><rect class="robot-face" x="17" y="23" width="30" height="20" rx="7"/><circle class="robot-eye" cx="25" cy="32" r="3"/><circle class="robot-eye" cx="39" cy="32" r="3"/><path class="robot-mouth" d="M25 38q7 5 14 0"/><path class="robot-body" d="M21 52v5m22-5v5"/></svg><span class="sp-ai-online"></span>';
    const bubble=make('button','sp-ai-nudge',tr('هل تحتاج مساعدة يا '+workerName()+'؟','Need any help, '+workerName()+'?'));
    bubble.type='button';bubble.hidden=true; bubble.setAttribute('aria-label',tr('افتح نوفا للمساعدة','Open NOVA for help'));
    const panel=make('section','sp-ai-panel');panel.id='spAiPanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','spAiTitle');
    const header=make('div','sp-ai-header');
    const titleWrap=make('div','sp-ai-title-wrap');
    titleWrap.appendChild(make('strong','','NOVA · نوفا'));titleWrap.firstChild.id='spAiTitle';
    titleWrap.appendChild(make('small','',tr('مساعدك الشخصي في ShiftPro','Your personal ShiftPro assistant')));
    const close=make('button','sp-ai-close','×');close.type='button';close.setAttribute('aria-label',tr('إغلاق','Close'));
    const robot=make('div','sp-ai-header-robot');robot.innerHTML=launcher.innerHTML;
    header.append(robot,titleWrap,close);
    const notice=make('div','sp-ai-notice',tr('نوفا يعمل بالأوامر المحلية بدون API للوظائف المدعومة. أي تغيير مهم يحتاج تأكيدك.','NOVA uses local commands without an API for supported features. Important changes require your confirmation.'));
    const messages=make('div','sp-ai-messages');messages.id='spAiMessages';messages.setAttribute('role','list');
    addMessage(messages,'assistant',tr('أهلًا يا '+workerName()+'! أنا نوفا، مساعدك الشخصي في ShiftPro. أحب أساعدك في إيه؟ أقدر أفتح الأقسام وأعرض ملخص البيانات وأساعدك في الحضور والانصراف.','Hi '+workerName()+'! I’m NOVA, your personal ShiftPro assistant. What would you like help with? I can open sections, summarize visible data, and help with check-in and check-out.'));
    const examples=make('div','sp-ai-examples');
    [tr('افتح التقارير','Open reports'),tr('افتح الراتب','Open salary'),tr('اعرض ملخص راتبي','Summarize my salary'),tr('اسأل عن قانون العمل','Ask about labor law'),tr('تسجيل حضور','Check in')].forEach(example=>{const b=make('button','',example);b.type='button';b.addEventListener('click',()=>{input.value=example;input.focus()});examples.appendChild(b)});
    const form=make('form','sp-ai-form'),input=make('textarea','sp-ai-input');input.id='spAiInput';input.rows=2;input.maxLength=MAX_MESSAGE;input.required=true;input.placeholder=tr('اكتب لنوفا هتحتاج إيه…','Tell NOVA what you need…');input.setAttribute('aria-label',input.placeholder);
    const voice=make('button','sp-ai-voice','🎙️');voice.type='button';voice.className='sp-ai-voice';voice.title=tr('تحدث وسيحوّل نوفا كلامك إلى نص','Speak to NOVA');voice.setAttribute('aria-label',voice.title);
    const speak=make('button','sp-ai-voice','🔊');speak.type='button';speak.title=tr('تشغيل أو إيقاف الرد الصوتي','Toggle spoken replies');speak.setAttribute('aria-label',speak.title);speak.setAttribute('aria-pressed','false');
    const send=make('button','sp-ai-send',tr('إرسال','Send'));send.type='submit';form.append(input,voice,speak,send);
    speak.addEventListener('click',()=>{voiceReplies=!voiceReplies;speak.textContent=voiceReplies?'🔈':'🔊';speak.setAttribute('aria-pressed',String(voiceReplies));speak.classList.toggle('is-active',voiceReplies);if(!voiceReplies&&global.speechSynthesis)global.speechSynthesis.cancel();else speakText(tr('تم تشغيل الرد الصوتي','Spoken replies are now enabled'));});
    voice.addEventListener('click',()=>{
      const Recognition=global.SpeechRecognition||global.webkitSpeechRecognition;
      if(!Recognition){addMessage(messages,'assistant',tr('المتصفح ده مش بيدعم تحويل الكلام لنص. جرّب Chrome المحدث أو اكتب طلبك.','Speech recognition is not supported in this browser. Try an updated Chrome browser or type your request.'));return;}
      if(recognition){try{recognition.stop()}catch(_){}recognition=null;voice.classList.remove('is-listening');return;}
      recognition=new Recognition();recognition.lang=isAr()?'ar-EG':'en-US';recognition.interimResults=true;recognition.continuous=false;
      voice.classList.add('is-listening');voice.textContent='⏹️';
      recognition.onresult=event=>{let transcript='';for(let j=event.resultIndex;j<event.results.length;j++)transcript+=event.results[j][0].transcript;input.value=transcript;};
      recognition.onerror=()=>{addMessage(messages,'assistant',tr('ماقدرتش أسمع الكلام بوضوح. اتأكد من إذن الميكروفون وحاول تاني.','I could not recognize the speech. Check microphone permission and try again.'));};
      recognition.onend=()=>{recognition=null;voice.classList.remove('is-listening');voice.textContent='🎙️';input.focus();};
      try{recognition.start()}catch(_){recognition=null;voice.classList.remove('is-listening');voice.textContent='🎙️';}
    });
    const footer=make('small','sp-ai-footer',tr('الأوامر المحلية تعمل بدون API؛ الأسئلة العامة قد تحتاج ربط خدمة خارجية اختياريًا.','Local actions work without an API; general questions may optionally use an external service.'));
    panel.append(header,notice,messages,examples,form,footer);document.body.append(launcher,bubble,panel);
    function showNudge(){if(panel.hidden&&!document.hidden){bubble.textContent=nudgeIndex++%2===0?tr('هل تحتاج مساعدة يا '+workerName()+'؟','Need any help, '+workerName()+'?'):tr('نوفا هنا لو احتجت أي حاجة','NOVA is here if you need anything');bubble.hidden=false;bubble.classList.add('is-visible');global.setTimeout(()=>{bubble.classList.remove('is-visible');global.setTimeout(()=>{bubble.hidden=true},350)},7000)}}
    launcher.addEventListener('click',()=>{bubble.hidden=true;panel.hidden?openPanel(panel,input):closePanel(panel,launcher)});
    bubble.addEventListener('click',()=>{bubble.hidden=true;openPanel(panel,input)});
    close.addEventListener('click',()=>closePanel(panel,launcher));
    nudgeTimer=global.setInterval(showNudge,60000);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;const message=input.value.trim();if(!message)return;
      if(message.length>MAX_MESSAGE){addMessage(messages,'assistant',tr('الطلب طويل جدًا. اختصره من فضلك.','That request is too long. Please shorten it.'));return}
      addMessage(messages,'user',message);input.value='';
      const legalReply=lawAnswer(message);\n      if(legalReply){addMessage(messages,'assistant',legalReply);return}\n      const localReply=localAction(message);
      if(localReply){addMessage(messages,'assistant',localReply);return}
      const key=getLocalApiKey(),endpoint=getEndpoint();
      if(!key&&(!endpoint||endpoint.includes('YOUR-WORKER.workers.dev'))){addMessage(messages,'assistant',tr('أنا نوفا يا '+workerName()+' 😊 الأمر ده مش من الأوامر المحلية اللي اتعرفت عليها لسه. جرّب فتح قسم أو طلب ملخص. تقدر تستخدم الوظائف المدعومة بدون API، أما فهم الطلبات العامة فمحتاج ربط اختياري.','I’m NOVA 😊 I don’t recognize that as a local command yet. Try opening a section or asking for a summary. Supported actions work without an API; general language understanding needs an optional connection.'));return}
      const waiting=addMessage(messages,'assistant',tr('لحظة، بفهم طلبك…','Thinking…'));setBusy(true,send,input);
      try{
        const response=await fetch(key?CODECRAFT_URL:endpoint,{method:'POST',headers:key?{'Content-Type':'application/json','Authorization':'Bearer '+key}:{'Content-Type':'application/json'},body:JSON.stringify(key?{model:CODECRAFT_MODEL,messages:[{role:'user',content:message}],max_tokens:500,stream:false}:{message,locale:locale()})});
        const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||data.message||'request_failed');
        const reply=key?data.choices?.[0]?.message?.content:data.reply;waiting.textContent=String(reply||tr('لم يصل رد واضح من المساعد.','The assistant returned no clear response.'));
      }catch(error){waiting.textContent=tr('تعذر الاتصال بالخدمة الاختيارية. الوظائف المحلية ما زالت متاحة بدون API.','The optional service could not be reached. Local actions remain available without an API.');console.warn('[SPAssistant] request failed:',error&&error.message)}
      finally{setBusy(false,send,input);input.focus()}
    });
    if(global.SPi18n&&global.SPi18n.subscribe)global.SPi18n.subscribe(()=>{panel.dir=isAr()?'rtl':'ltr';input.placeholder=tr('اكتب لنوفا هتحتاج إيه…','Tell NOVA what you need…');bubble.textContent=tr('هل تحتاج مساعدة يا '+workerName()+'؟','Need any help, '+workerName()+'?')});
    panel.dir=isAr()?'rtl':'ltr';console.log('[SPAssistant] NOVA local-first assistant ready.');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  global.SPAssistant={init,getEndpoint};
})(window);
