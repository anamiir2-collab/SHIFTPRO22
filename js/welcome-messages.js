/* ShiftPro — رسائل الترحيب والتحفيز
   الرسائل مستقلة لتسهيل تعديلها وإضافة رسائل جديدة.
   {name} يُستبدل باسم الموظف تلقائيًا.
   تُختار رسالة عشوائية مع تجنب تكرار آخر 5 رسائل قدر الإمكان.
*/
(function (global) {
  'use strict';

  const messages = {
    ar: [
      'استعن بالله يا {name} ولا تعجز.. كل جهد تبذله في الحلال له قيمة.',
      'ابدأ يومك بالتوكل على الله.. واسعَ واجتهد، فالرزق بيد الله.',
      'احتسب تعبك عند الله.. فما كان لله لا يضيع أجره.',
      'رزقك مكتوب، وسعيك مطلوب.. فاجمع بين حسن التوكل وإتقان العمل.',
      'اللهم بارك في يومك ورزقك وجهدك، واجعل عملك بابًا للخير والبركة يا {name}.',
      'لا تستصغر عملًا حلالًا.. فرب عمل بسيط يفتح الله به أبوابًا كبيرة.',
      'اجعل نيتك طيبة وعملك متقنًا.. فالبركة ليست بكثرة المال وحده.',
      'اطمئن يا {name}، فالله يعلم سعيك وتعبك.. استمر في طريقك ولا تيأس.',
      'ابدأ باسم الله، وأخلص نيتك، وأحسن عملك.. واترك النتائج على الله.',
      'اسعَ في رزقك بكرامة وأمانة.. فالرزق الطيب يستحق السعي والصبر.',
      'مش كل يوم هيكون سهل يا {name}.. لكن كل يوم فرصة جديدة تثبت فيها قوتك.',
      'التعب مؤقت، لكن أثر الاجتهاد ممكن يفضل سنين.. كمّل.',
      'لو يومك صعب، افتكر إنك قدرت تتجاوز أيام أصعب منه.',
      'لا تجعل تعثر خطوة يوقف مسيرتك.. عدّل طريقك وابدأ من جديد.',
      'النجاح مش إنك متغلطش.. النجاح إنك تتعلم من غلطك وتتحسن.',
      'خليك صبورًا مع النتائج، وحازمًا في السعي، وواثقًا في قدرتك على التطور.',
      'كل مشكلة بتحلها بتضيف لخبرتك.. واجهها بعقل هادئ.',
      'مش مطلوب منك تكون مثالي.. المطلوب إنك تحاول وتتعلم وتتحسن.',
      'وقت الضغط بيكشف مهاراتك.. نظّم أولوياتك وخد الأمور خطوة بخطوة.',
      'الاستمرار بخطوات صغيرة أفضل من الحماس اللي بينتهي بسرعة.',
      'اعمل شغلك كأن اسمك مكتوب عليه يا {name}.. فجودة عملك بتعكس قيمتك.',
      'الإنجاز الحقيقي مش في إنك تخلص بسرعة وبس.. لكن إنك تخلص صح.',
      'ركّز على المهمة اللي قدامك.. خطوة متقنة أفضل من خطوات كتير بلا تركيز.',
      'كل دقيقة بتنظمها صح بتقرّبك من إنجاز أكبر.',
      'راجع شغلك قبل ما تسلمه.. التفاصيل الصغيرة هي اللي بتصنع الفرق.',
      'طوّر نفسك كل يوم ولو بمعلومة واحدة.. المعرفة استثمار في مستقبلك.',
      'خليك صاحب أثر طيب في مكان شغلك.. مش مجرد شخص بيؤدي المطلوب.',
      'لما تخلص مهمة، اسأل نفسك: هل أقدر أعملها بشكل أفضل المرة الجاية؟',
      'النجاح مش ضربة حظ.. النجاح عادات صغيرة بتتكرر كل يوم.',
      'ابدأ بالأهم، وأنجز بهدوء، واحتفل بتقدمك مهما كان بسيطًا.',
      'الأمانة في الشغل مش مجرد واجب.. دي قيمة بتبني ثقة الناس فيك.',
      'كلمة طيبة لزميلك ممكن تخفف عنه يومًا صعبًا.. خليك سببًا في الخير.',
      'اختلاف الآراء طبيعي.. لكن الاحترام هو اللي بيخلّي الفريق أقوى.',
      'ساعد زميلك وقت احتياجه.. فالفريق الناجح بيقوم على التعاون.',
      'حافظ على حقوق غيرك زي ما بتحب الناس تحافظ على حقوقك.',
      'لو أخطأت، اعترف وصحح.. الاعتراف بالخطأ قوة مش ضعف.',
      'خليك عادلًا في حكمك، صادقًا في كلامك، وأمينًا في مسؤولياتك.',
      'مش لازم تكون الأعلى صوتًا عشان تكون مؤثرًا.. خليك الأعلى التزامًا وأخلاقًا.',
      'احترم وقت زملائك ومجهودهم.. فالتعاون الحقيقي بيبدأ من احترام الآخرين.',
      'سيب وراك سمعة طيبة.. فالأخلاق الحلوة بتفضل في ذاكرة الناس.',
      'صحتك أمانة يا {name}.. اشتغل بجد وخد راحتك وقت ما تحتاج.',
      'مش كل تأخير فشل.. أحيانًا التمهل بيحميك من أخطاء كتير.',
      'خد نفسًا هاديًا ورتّب أفكارك.. مش كل حاجة محتاجة تتحل في لحظة.',
      'افتكر النعم اللي عندك وسط انشغالك.. الامتنان بيخلّي نظرتك أهدى.',
      'لو ما حققتش كل أهدافك النهارده، ما تلغيش قيمة اللي أنجزته.. بكرة فرصة جديدة.',
      'ما تقارنش رحلتك برحلة غيرك.. لكل إنسان ظروفه وخطواته وتوقيته.',
      'بعد يوم طويل، ادّي لنفسك حقها في الراحة.. الاستمرار محتاج طاقة متجددة.',
      'خليك مرنًا مع التغيير.. أحيانًا الفرص الجديدة بتيجي في صورة تحديات.',
      'قيمتك أكبر من مهمة أنجزتها أو يوم كان صعبًا عليك.. أنت بتتعلم وبتتطور.',
      'اقفل يومك برضا عن سعيك، وتعلّم من أخطائك، وابدأ بكرة بأمل أكبر.'
    ],
    en: [
      'Trust in God and keep going, {name}. Every honest effort you make has value.',
      'Start your day with trust in God and do your best; provision comes from Him.',
      'Let your effort be sincere; good deeds done with good intentions are never wasted.',
      'Your provision is written, and your effort matters. Combine trust with excellent work.',
      'May your day, effort, and provision be blessed with goodness, {name}.',
      'Never look down on honest work; a small task can open big doors.',
      'Keep your intentions good and your work excellent; blessings mean more than money.',
      'God knows your effort and tiredness, {name}. Keep moving and do not lose hope.',
      'Begin in God’s name, work sincerely, do your best, and leave the outcome to Him.',
      'Seek your livelihood with dignity and honesty; good provision is worth patience.',
      'Not every day is easy, {name}, but each day is another chance to show your strength.',
      'Tiredness passes, but the impact of hard work can last for years. Keep going.',
      'If today is difficult, remember that you have made it through difficult days before.',
      'Do not let one setback stop your journey. Adjust your path and begin again.',
      'Success is not never making mistakes; it is learning from them and improving.',
      'Be patient with results, consistent in effort, and confident in your ability to grow.',
      'Every problem you solve adds to your experience. Face it with a calm mind.',
      'You do not have to be perfect. Keep trying, learning, and improving.',
      'Pressure can reveal your skills. Set priorities and take things one step at a time.',
      'Small consistent steps are better than motivation that quickly fades.',
      'Work as if your name is on the result, {name}; quality reflects your values.',
      'Real achievement is not only finishing quickly, but finishing well.',
      'Focus on the task in front of you. One careful step beats many unfocused ones.',
      'Every minute you organize well brings you closer to a bigger achievement.',
      'Review your work before submitting it; small details make a real difference.',
      'Learn something new every day; knowledge is an investment in your future.',
      'Leave a positive impact at work, not just a completed task.',
      'After finishing a task, ask yourself how you could do it even better next time.',
      'Success is not just luck; it is small good habits repeated every day.',
      'Start with what matters most, work calmly, and value every bit of progress.',
      'Honesty at work is more than a duty; it builds people’s trust in you.',
      'A kind word may ease a colleague’s difficult day. Be a source of goodness.',
      'Different opinions are normal; respect is what makes a team stronger.',
      'Help a colleague when needed. Successful teams are built on cooperation.',
      'Respect other people’s rights as you want them to respect yours.',
      'If you make a mistake, admit it and correct it. Accountability is strength.',
      'Be fair in judgment, truthful in speech, and honest in your responsibilities.',
      'You do not need to be the loudest to make an impact; be the most reliable.',
      'Respect your colleagues’ time and effort. Real teamwork starts with respect.',
      'Leave behind a good reputation; kindness and character are remembered.',
      'Your health matters, {name}. Work hard, and rest when you need to.',
      'A delay is not always failure; taking your time can prevent many mistakes.',
      'Take a calm breath and organize your thoughts. Not everything must be solved at once.',
      'Remember the good things in your life; gratitude can bring a calmer perspective.',
      'If you did not reach every goal today, value what you did achieve. Tomorrow is another chance.',
      'Do not compare your journey with someone else’s; everyone has a different path and pace.',
      'After a long day, give yourself time to rest. Lasting effort needs renewed energy.',
      'Stay flexible when things change; new opportunities sometimes arrive as challenges.',
      'Your worth is greater than one task or one difficult day. You are learning and growing.',
      'End the day appreciating your effort, learn from mistakes, and begin tomorrow with hope.'
    ]
  };

  const HISTORY_KEY = 'sp_welcome_message_history_v2';
  const HISTORY_LIMIT = 5;
  let selectedByLoad = null;

  function choose(locale) {
    const list = messages[locale] || messages.ar;
    if (selectedByLoad !== null) return list[selectedByLoad % list.length];

    let history = [];
    try {
      const stored = JSON.parse(global.localStorage.getItem(HISTORY_KEY) || '{}');
      history = Array.isArray(stored[locale]) ? stored[locale] : [];
    } catch (_) {}

    const candidates = list.map((_, index) => index).filter(index => !history.includes(index));
    const pool = candidates.length ? candidates : list.map((_, index) => index);
    selectedByLoad = pool[Math.floor(Math.random() * pool.length)];

    try {
      const stored = JSON.parse(global.localStorage.getItem(HISTORY_KEY) || '{}');
      stored[locale] = [selectedByLoad, ...(Array.isArray(stored[locale]) ? stored[locale] : [])].slice(0, HISTORY_LIMIT);
      global.localStorage.setItem(HISTORY_KEY, JSON.stringify(stored));
    } catch (_) {}

    return list[selectedByLoad % list.length];
  }

  function render(name, locale) {
    const card = document.getElementById('dailyWelcomeMessage');
    const text = document.getElementById('dailyWelcomeMessageText');
    if (!card || !text) return;
    const lang = messages[locale] ? locale : 'ar';
    const safeName = (name || '').trim() || (lang === 'en' ? 'there' : 'صديقي');
    const template = choose(lang);
    text.textContent = template.replace(/\{name\}/g, safeName);
    card.hidden = false;
    card.setAttribute('aria-live', 'polite');
    card.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  }

  global.SPWelcomeMessages = { render };
})(window);
