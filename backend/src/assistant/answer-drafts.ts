/**
 * THE FIRST ANSWERS, DRAFTED BY THE ASSISTANT AND NOT YET APPROVED BY ANYBODY.
 *
 * Every one of these is DRAFT and marked as written by the assistant. Nothing here
 * is ever shown to a person until a member of staff reads it and approves it. That
 * is not caution for its own sake: these are drawn out of the terms and the privacy
 * policy, and a wrong promise about somebody's money is the worst thing this
 * system could do.
 *
 * WHAT THEY ARE DRAWN FROM, and nothing else:
 *   src/ui/policy.js      the ten terms sections and the six privacy sections
 *   src/ui/support.js     the four help subjects the app already offers
 *   src/tickets/ticket.constants.ts   the real ticket numbers
 *
 * Every entry names its source in `drawnFrom` so nobody has to take my word for it.
 *
 * NOTHING IS INVENTED. No refund percentage, no timeline, no promise that is not
 * already written down somewhere in this project. Where the honest answer is "we
 * have never written that down", the entry says a person will confirm it and is
 * marked `needsARealAnswer` so it comes out in a list rather than sitting there
 * looking finished.
 *
 * THE HINDI IS NOT CHECKED. Both Hindi wordings were written by the assistant and
 * have not been read by somebody who speaks Hindi. They are drafts like the rest,
 * and the staff screen says so on every one.
 */

export type DraftLanguage = 'en' | 'hi' | 'hi-en';

export interface DraftWording {
  title: string;
  body: string;
  /** Ways somebody might really ask for this. */
  phrases: string[];
}

export interface AnswerDraftSet {
  key: string;
  /** Which part of the app this is about. Drives the small journey nudge. */
  topic: string;
  /** Where in this project the words came from. */
  drawnFrom: string;
  /**
   * True when the full answer is NOT written down anywhere in the project, so the
   * draft says what we do know and then hands over to a person.
   */
  needsARealAnswer?: boolean;
  wordings: Record<DraftLanguage, DraftWording>;
}

/** The honest hand-over, used wherever we would otherwise be making something up. */
const OVER_TO_A_PERSON = {
  en: 'We have not written that down yet, so a person from Fayr will confirm it for you.',
  hi: 'यह बात हमने अभी तक लिखी नहीं है। फेयर का कोई व्यक्ति आपको यह बता देगा।',
  'hi-en':
    'Yeh baat humne abhi tak likhi nahi hai. Fayr ka koi vyakti aapko yeh bata dega.',
};

export const ANSWER_DRAFTS: AnswerDraftSet[] = [
  {
    key: 'what-fayr-is',
    topic: 'about',
    drawnFrom: 'src/ui/policy.js, terms section "What Fayr is"',
    wordings: {
      en: {
        title: 'What Fayr does',
        body:
          'You pick an offer here. You buy the product yourself at the shop. ' +
          'You write your own honest review. When your review is showing on the ' +
          'product page, we wait. Once the shop’s return time is over, we put ' +
          'the money back in your Fayr wallet. You keep the product.',
        phrases: [
          'what is fayr',
          'how does fayr work',
          'what do you do',
          'how do i get my money back',
          'explain fayr to me',
        ],
      },
      hi: {
        title: 'फेयर क्या करता है',
        body:
          'आप यहाँ एक ऑफर चुनते हैं। फिर आप खुद दुकान से वह सामान खरीदते हैं। ' +
          'फिर आप अपना सच्चा रिव्यू लिखते हैं। जब आपका रिव्यू सामान के पेज पर दिखने ' +
          'लगता है, तब हम इंतज़ार करते हैं। दुकान का वापसी का समय खत्म होने पर हम ' +
          'आपका पैसा आपके फेयर वॉलेट में डाल देते हैं। सामान आपका ही रहता है।',
        phrases: ['फेयर क्या है', 'यह कैसे काम करता है', 'पैसा कैसे मिलेगा'],
      },
      'hi-en': {
        title: 'Fayr kya karta hai',
        body:
          'Aap yahan ek offer chunte hain. Phir aap khud dukaan se wo saman ' +
          'kharidte hain. Phir aap apna saccha review likhte hain. Jab aapka ' +
          'review saman ke page par dikhne lagta hai, tab hum intezaar karte hain. ' +
          'Dukaan ka wapsi ka samay khatam hone par hum aapka paisa aapke Fayr ' +
          'wallet mein daal dete hain. Saman aapka hi rehta hai.',
        phrases: [
          'fayr kya hai',
          'yeh kaise kaam karta hai',
          'paisa kaise milega',
        ],
      },
    },
  },
  {
    key: 'how-much-comes-back',
    topic: 'refund',
    drawnFrom: 'src/ui/policy.js, terms section "What we refund"',
    wordings: {
      en: {
        title: 'How much money comes back',
        body:
          'We pay back a share of what you were really charged for the product. ' +
          'Not the crossed-out price, and not the price on the label. If you paid ' +
          'less than the price on the offer, we use the lower amount. Delivery ' +
          'charges and other things in the same order are not counted.',
        phrases: [
          'how much refund will i get',
          'how much money will i get back',
          'is the full amount returned',
          'why is my refund less than the price',
        ],
      },
      hi: {
        title: 'कितना पैसा वापस आता है',
        body:
          'सामान के लिए आपने असल में जितना पैसा दिया, उसी का एक हिस्सा वापस आता है। ' +
          'काटा हुआ दाम नहीं, और लेबल का दाम भी नहीं। अगर आपने ऑफर के दाम से कम दिया ' +
          'है, तो हम कम वाला ही मानते हैं। डिलीवरी का खर्च और उसी ऑर्डर की दूसरी ' +
          'चीज़ें इसमें नहीं गिनी जातीं।',
        phrases: [
          'कितना पैसा मिलेगा',
          'पूरा पैसा मिलेगा क्या',
          'रिफंड कम क्यों है',
        ],
      },
      'hi-en': {
        title: 'Kitna paisa wapas aata hai',
        body:
          'Saman ke liye aapne asal mein jitna paisa diya, usi ka ek hissa wapas ' +
          'aata hai. Kata hua daam nahi, aur label ka daam bhi nahi. Agar aapne ' +
          'offer ke daam se kam diya hai, to hum kam wala hi maante hain. Delivery ' +
          'ka kharch aur usi order ki dusri cheezein isme nahi ginti.',
        phrases: [
          'kitna paisa milega',
          'pura paisa milega kya',
          'refund kam kyun hai',
        ],
      },
    },
  },
  {
    key: 'how-to-pay',
    topic: 'order',
    drawnFrom: 'src/ui/policy.js, terms section "How you must pay"',
    wordings: {
      en: {
        title: 'How you should pay for the product',
        body:
          'Pay in a way that leaves a real charge we can see. A card, UPI, net ' +
          'banking, or cash when it arrives. Shop gift cards, shop wallet money ' +
          'and free credit do not work here. There is no real charge for us to ' +
          'look at, so we cannot pay you back for one.',
        phrases: [
          'how should i pay',
          'can i use a gift card',
          'can i pay with wallet money',
          'is cash on delivery allowed',
        ],
      },
      hi: {
        title: 'सामान का पैसा कैसे दें',
        body:
          'ऐसे पैसे दें जिसका सही रिकॉर्ड हमें दिख सके। कार्ड, यूपीआई, नेट बैंकिंग, ' +
          'या सामान आने पर नकद। दुकान का गिफ्ट कार्ड, दुकान के वॉलेट का पैसा और ' +
          'मुफ्त क्रेडिट यहाँ नहीं चलता। उसमें हमें देखने के लिए कोई सही चार्ज नहीं ' +
          'मिलता, इसलिए हम उसका पैसा वापस नहीं कर पाते।',
        phrases: [
          'पैसे कैसे दें',
          'गिफ्ट कार्ड चलेगा क्या',
          'कैश ऑन डिलीवरी चलेगा',
        ],
      },
      'hi-en': {
        title: 'Saman ka paisa kaise dein',
        body:
          'Aise paise dein jiska sahi record humein dikh sake. Card, UPI, net ' +
          'banking, ya saman aane par nakad. Dukaan ka gift card, dukaan ke wallet ' +
          'ka paisa aur muft credit yahan nahi chalta. Usme humein dekhne ke liye ' +
          'koi sahi charge nahi milta, isliye hum uska paisa wapas nahi kar paate.',
        phrases: [
          'paise kaise dein',
          'gift card chalega kya',
          'cash on delivery chalega',
        ],
      },
    },
  },
  {
    key: 'honest-reviews',
    topic: 'review',
    drawnFrom: 'src/ui/policy.js, terms section "Your review is yours"',
    wordings: {
      en: {
        title: 'Your review is your own',
        body:
          'Write what you really think. We never ask you for a number of stars. ' +
          'We never ask you to change what you wrote. A review that says you did ' +
          'not like the product is paid exactly the same as a happy one. Please do ' +
          'not mention Fayr, money back, or any reward inside the review.',
        phrases: [
          'do i have to give five stars',
          'can i write a bad review',
          'what should my review say',
          'can i mention fayr in my review',
        ],
      },
      hi: {
        title: 'रिव्यू आपका अपना है',
        body:
          'जो आपको सच में लगता है, वही लिखें। हम कभी नहीं कहते कि कितने स्टार दें। ' +
          'हम कभी नहीं कहते कि लिखा हुआ बदलें। अगर आपको सामान पसंद नहीं आया, तब भी ' +
          'पैसा उतना ही मिलता है। रिव्यू के अंदर फेयर, पैसा वापस, या किसी इनाम का ' +
          'नाम मत लिखें।',
        phrases: [
          'क्या पाँच स्टार देना ज़रूरी है',
          'खराब रिव्यू लिख सकते हैं',
          'रिव्यू में क्या लिखें',
        ],
      },
      'hi-en': {
        title: 'Review aapka apna hai',
        body:
          'Jo aapko sach mein lagta hai, wahi likhein. Hum kabhi nahi kehte ki ' +
          'kitne star dein. Hum kabhi nahi kehte ki likha hua badlein. Agar aapko ' +
          'saman pasand nahi aaya, tab bhi paisa utna hi milta hai. Review ke ' +
          'andar Fayr, paisa wapas, ya kisi inaam ka naam mat likhein.',
        phrases: [
          'paanch star dena zaroori hai',
          'kharab review likh sakte hain',
          'review mein kya likhein',
        ],
      },
    },
  },
  {
    key: 'one-order-one-refund',
    topic: 'order',
    drawnFrom: 'src/ui/policy.js, terms section "One purchase, one refund"',
    wordings: {
      en: {
        title: 'One order pays for one offer',
        body:
          'The same order can only be paid back on one offer. If the same order ' +
          'number turns up on a second offer, we hold it and a person from Fayr ' +
          'looks at it. A real basket with several different products can count ' +
          'more than once. A person has to confirm that first.',
        phrases: [
          'can i use one order for two offers',
          'i bought two things in one order',
          'why is my second claim on hold',
        ],
      },
      hi: {
        title: 'एक ऑर्डर, एक ऑफर',
        body:
          'एक ही ऑर्डर पर सिर्फ एक ऑफर का पैसा मिलता है। अगर वही ऑर्डर नंबर दूसरे ' +
          'ऑफर पर आता है, तो हम उसे रोक देते हैं। फिर फेयर का कोई व्यक्ति उसे देखता ' +
          'है। एक ही ऑर्डर में अलग-अलग सामान हों तो एक से ज़्यादा बार भी चल सकता है। ' +
          'पहले कोई व्यक्ति उसे पक्का करता है।',
        phrases: [
          'एक ऑर्डर दो ऑफर',
          'एक ऑर्डर में दो सामान',
          'दूसरा क्लेम क्यों रुका है',
        ],
      },
      'hi-en': {
        title: 'Ek order, ek offer',
        body:
          'Ek hi order par sirf ek offer ka paisa milta hai. Agar wahi order number ' +
          'dusre offer par aata hai, to hum use rok dete hain. Phir Fayr ka koi ' +
          'vyakti use dekhta hai. Ek hi order mein alag alag saman hon to ek se ' +
          'zyada baar bhi chal sakta hai. Pehle koi vyakti use pakka karta hai.',
        phrases: [
          'ek order do offer',
          'ek order mein do saman',
          'dusra claim kyun ruka hai',
        ],
      },
    },
  },
  {
    key: 'waiting-period',
    topic: 'refund',
    drawnFrom: 'src/ui/policy.js, terms section "The waiting period"',
    wordings: {
      en: {
        title: 'Why there is a wait before the money comes back',
        body:
          'We wait until the shop’s own return time has finished. While we wait, ' +
          'we look at the product page again to make sure your review is still ' +
          'there. If the review disappears before the wait is over, the money is ' +
          'not sent. Your offer page shows where you are up to.',
        phrases: [
          'why do i have to wait',
          'how long is the wait',
          'when does the holding period end',
          'why is my offer still waiting',
        ],
      },
      hi: {
        title: 'पैसा आने से पहले इंतज़ार क्यों',
        body:
          'हम दुकान के अपने वापसी के समय के खत्म होने तक इंतज़ार करते हैं। इस बीच हम ' +
          'सामान का पेज दोबारा देखते हैं कि आपका रिव्यू अब भी है या नहीं। अगर रिव्यू ' +
          'इंतज़ार खत्म होने से पहले हट जाता है, तो पैसा नहीं भेजा जाता। आपके ऑफर के ' +
          'पेज पर दिखता है कि आप कहाँ तक पहुँचे हैं।',
        phrases: [
          'इंतज़ार क्यों करना है',
          'कितना इंतज़ार',
          'ऑफर अब भी क्यों रुका है',
        ],
      },
      'hi-en': {
        title: 'Paisa aane se pehle intezaar kyun',
        body:
          'Hum dukaan ke apne wapsi ke samay ke khatam hone tak intezaar karte hain. ' +
          'Is beech hum saman ka page dobara dekhte hain ki aapka review ab bhi hai ' +
          'ya nahi. Agar review intezaar khatam hone se pehle hat jata hai, to ' +
          'paisa nahi bheja jata. Aapke offer ke page par dikhta hai ki aap kahan ' +
          'tak pahunche hain.',
        phrases: [
          'intezaar kyun karna hai',
          'kitna intezaar',
          'offer ab bhi kyun ruka hai',
        ],
      },
    },
  },
  {
    key: 'review-removed-after-payout',
    topic: 'review',
    drawnFrom:
      'src/ui/policy.js, terms section "If a review is removed after payout"',
    wordings: {
      en: {
        title: 'If your review goes away after we have paid you',
        body:
          'If you delete or hide your review after we have paid you, we may take ' +
          'the money back. The same is true if you change the review a lot, or if ' +
          'you send the product back to the shop. We may take it off your wallet, ' +
          'or hold back later money. We always tell you why first.',
        phrases: [
          'can i delete my review later',
          'what if i return the product',
          'why was money taken from my wallet',
          'can you take the refund back',
        ],
      },
      hi: {
        title: 'पैसा मिलने के बाद रिव्यू हट जाए तो',
        body:
          'पैसा मिलने के बाद अगर आप रिव्यू हटा देते हैं या छिपा देते हैं, तो हम पैसा ' +
          'वापस ले सकते हैं। यही बात तब भी है जब आप रिव्यू में बहुत बदलाव कर दें, या ' +
          'सामान दुकान को लौटा दें। हम आपके वॉलेट से ले सकते हैं, या आगे का पैसा रोक ' +
          'सकते हैं। हम पहले आपको कारण बताते हैं।',
        phrases: [
          'रिव्यू हटा सकते हैं क्या',
          'सामान लौटा दें तो',
          'वॉलेट से पैसा क्यों कटा',
        ],
      },
      'hi-en': {
        title: 'Paisa milne ke baad review hat jaye to',
        body:
          'Paisa milne ke baad agar aap review hata dete hain ya chhipa dete hain, ' +
          'to hum paisa wapas le sakte hain. Yahi baat tab bhi hai jab aap review ' +
          'mein bahut badlav kar dein, ya saman dukaan ko lauta dein. Hum aapke ' +
          'wallet se le sakte hain, ya aage ka paisa rok sakte hain. Hum pehle ' +
          'aapko karan batate hain.',
        phrases: [
          'review hata sakte hain kya',
          'saman lauta dein to',
          'wallet se paisa kyun kata',
        ],
      },
    },
  },
  {
    key: 'one-account-per-person',
    topic: 'account',
    drawnFrom: 'src/ui/policy.js, terms section "One person, one account"',
    wordings: {
      en: {
        title: 'One person can have one account',
        body:
          'Each person gets one account. We check this with your PAN and the ' +
          'details you give us for getting paid. More than one account, sharing ' +
          'payout details with somebody else, or claiming for somebody else’s ' +
          'shopping will close the account. Money not yet paid is lost.',
        phrases: [
          'can i make two accounts',
          'can my family use my account',
          'why do you need my pan',
          'why was my account closed',
        ],
      },
      hi: {
        title: 'एक व्यक्ति, एक खाता',
        body:
          'हर व्यक्ति का एक ही खाता होता है। हम इसे आपके पैन और पैसे लेने की जानकारी ' +
          'से जाँचते हैं। एक से ज़्यादा खाते रखना मना है। किसी और के साथ पैसे लेने की ' +
          'जानकारी बाँटना भी मना है। किसी और की खरीद पर दावा करना भी मना है। ऐसा ' +
          'होने पर खाता बंद हो जाता है। जो पैसा अभी नहीं मिला है, वह चला जाता है।',
        phrases: [
          'दो खाते बना सकते हैं',
          'पैन क्यों चाहिए',
          'खाता बंद क्यों हुआ',
        ],
      },
      'hi-en': {
        title: 'Ek vyakti, ek khata',
        body:
          'Har vyakti ka ek hi khata hota hai. Hum ise aapke PAN aur paise lene ki ' +
          'jankari se jaanchte hain. Ek se zyada khate rakhna mana hai. Kisi aur ' +
          'ke saath paise lene ki jankari baantna bhi mana hai. Kisi aur ki ' +
          'kharid par dava karna bhi mana hai. Aisa hone par khata band ho jata ' +
          'hai. Jo paisa abhi nahi mila hai, wo chala jata hai.',
        phrases: [
          'do khate bana sakte hain',
          'pan kyun chahiye',
          'khata band kyun hua',
        ],
      },
    },
  },
  {
    key: 'tickets',
    topic: 'tickets',
    drawnFrom:
      'src/ui/policy.js terms section "Tickets", and the real numbers in src/tickets/ticket.constants.ts',
    wordings: {
      en: {
        title: 'What tickets are',
        body:
          'Tickets are what you spend to join an offer. You start with fifteen. ' +
          'Joining an offer uses five. If the offer runs out of time before you ' +
          'buy, those five come back. You get ten back once a finished refund has ' +
          'been paid out to you. Tickets are not money and cannot be given away.',
        phrases: [
          'what are tickets',
          'how many tickets do i have',
          'why did my tickets go down',
          'how do i get more tickets',
          'i have no tickets left',
        ],
      },
      hi: {
        title: 'टिकट क्या हैं',
        body:
          'ऑफर में शामिल होने के लिए टिकट खर्च होते हैं। शुरू में आपको पंद्रह मिलते ' +
          'हैं। एक ऑफर में शामिल होने पर पाँच लगते हैं। खरीदने से पहले ऑफर का समय ' +
          'खत्म हो जाए, तो वो पाँच वापस आ जाते हैं। पूरा पैसा मिल जाने पर दस टिकट ' +
          'वापस मिलते हैं। टिकट पैसा नहीं हैं और किसी को दिए नहीं जा सकते।',
        phrases: ['टिकट क्या है', 'मेरे कितने टिकट हैं', 'टिकट कम क्यों हो गए'],
      },
      'hi-en': {
        title: 'Ticket kya hain',
        body:
          'Offer mein shamil hone ke liye ticket kharch hote hain. Shuru mein aapko ' +
          'pandrah milte hain. Ek offer mein shamil hone par paanch lagte hain. ' +
          'Kharidne se pehle offer ka samay khatam ho jaye, to wo paanch wapas aa ' +
          'jate hain. Pura paisa mil jane par das ticket wapas milte hain. Ticket ' +
          'paisa nahi hain aur kisi ko diye nahi ja sakte.',
        phrases: [
          'ticket kya hai',
          'mere kitne ticket hain',
          'ticket kam kyun ho gaye',
        ],
      },
    },
  },
  {
    key: 'wallet-and-withdrawals',
    topic: 'withdrawal',
    drawnFrom: 'src/ui/policy.js, terms section "Your wallet and withdrawals"',
    wordings: {
      en: {
        title: 'Your wallet and taking money out',
        body:
          'Money we pay back lands in your Fayr wallet first. From there you can ' +
          'ask us to send it to your own UPI or your own bank account. There is a ' +
          'smallest amount you can take out, and your wallet screen shows it. ' +
          'A person from Fayr checks every request before the money is sent.',
        phrases: [
          'how do i take my money out',
          'how do i withdraw',
          'where is my wallet money',
          'what is the minimum withdrawal',
          'can i send money to someone else',
        ],
      },
      hi: {
        title: 'आपका वॉलेट और पैसा निकालना',
        body:
          'वापस किया हुआ पैसा पहले आपके फेयर वॉलेट में आता है। वहाँ से आप उसे अपने ' +
          'यूपीआई या अपने बैंक खाते में भेजने को कह सकते हैं। निकालने की एक सबसे कम ' +
          'रकम होती है, जो आपके वॉलेट के पेज पर दिखती है। पैसा भेजने से पहले फेयर ' +
          'का कोई व्यक्ति हर अनुरोध देखता है।',
        phrases: [
          'पैसा कैसे निकालें',
          'वॉलेट का पैसा कहाँ है',
          'कम से कम कितना निकाल सकते हैं',
        ],
      },
      'hi-en': {
        title: 'Aapka wallet aur paisa nikalna',
        body:
          'Wapas kiya hua paisa pehle aapke Fayr wallet mein aata hai. Wahan se aap ' +
          'use apne UPI ya apne bank khate mein bhejne ko keh sakte hain. Nikalne ' +
          'ki ek sabse kam rakam hoti hai, jo aapke wallet ke page par dikhti hai. ' +
          'Paisa bhejne se pehle Fayr ka koi vyakti har anurodh dekhta hai.',
        phrases: [
          'paisa kaise nikalein',
          'wallet ka paisa kahan hai',
          'kam se kam kitna nikal sakte hain',
        ],
      },
    },
  },
  {
    key: 'refund-not-arrived',
    topic: 'refund',
    drawnFrom:
      'src/ui/support.js help subject "My refund has not arrived", explained with the terms sections "The waiting period" and "What Fayr is"',
    wordings: {
      en: {
        title: 'Your money has not come back yet',
        body:
          'Money comes back in this order. First your order is matched. Then the ' +
          'product arrives. Then your review shows on the product page. Then we ' +
          'wait for the shop’s return time to finish. Only after all of that does ' +
          'the money reach your wallet. Your offer page shows which step you are ' +
          'on. If it is stuck on one step, a person from Fayr can look at yours.',
        phrases: [
          'my refund has not arrived',
          'where is my refund',
          'when will my refund arrive',
          'i have not got my money',
          'refund not received',
          'money not received',
        ],
      },
      hi: {
        title: 'आपका पैसा अभी तक वापस नहीं आया',
        body:
          'पैसा इस क्रम में वापस आता है। पहले आपका ऑर्डर मिलाया जाता है। फिर सामान ' +
          'आपके पास पहुँचता है। फिर आपका रिव्यू सामान के पेज पर दिखता है। फिर हम ' +
          'दुकान के वापसी के समय के खत्म होने का इंतज़ार करते हैं। इसके बाद ही पैसा ' +
          'आपके वॉलेट में आता है। आपके ऑफर के पेज पर दिखता है कि आप किस कदम पर हैं। ' +
          'कहीं अटका हो तो फेयर का कोई व्यक्ति आपका देख सकता है।',
        phrases: [
          'मेरा पैसा कब आएगा',
          'रिफंड नहीं आया',
          'पैसा नहीं मिला',
          'मेरा रिफंड कहाँ है',
        ],
      },
      'hi-en': {
        title: 'Aapka paisa abhi tak wapas nahi aaya',
        body:
          'Paisa is kram mein wapas aata hai. Pehle aapka order milaya jata hai. ' +
          'Phir saman aapke paas pahunchta hai. Phir aapka review saman ke page ' +
          'par dikhta hai. Phir hum dukaan ke wapsi ke samay ke khatam hone ka ' +
          'intezaar karte hain. Iske baad hi paisa aapke wallet mein aata hai. ' +
          'Aapke offer ke page par dikhta hai ki aap kis kadam par hain. Kahin ' +
          'atka ho to Fayr ka koi vyakti aapka dekh sakta hai.',
        phrases: [
          'mera refund kab aayega',
          'refund nahi aaya',
          'paisa nahi mila',
          'mera paisa kab milega',
          'refund kab milega',
        ],
      },
    },
  },
  {
    key: 'order-not-found',
    topic: 'order',
    drawnFrom:
      'src/ui/support.js help subject "My order was not found", explained with the privacy section "What we read from a marketplace"',
    wordings: {
      en: {
        title: 'We could not find your order',
        body:
          'The app looks at your own order pages on your phone to find the buy. ' +
          'It matches by the product name and the amount you paid. It cannot find ' +
          'an order bought before you joined the offer. It also cannot find one ' +
          'bought on a different shopping account. You can send us a picture of ' +
          'the order page instead, and a person will check it.',
        phrases: [
          'my order was not found',
          'you cannot see my order',
          'order not detected',
          'why does it say no order',
        ],
      },
      hi: {
        title: 'हमें आपका ऑर्डर नहीं मिला',
        body:
          'ऐप आपके फोन पर आपके अपने ऑर्डर के पेज देखकर खरीद ढूँढता है। यह सामान के ' +
          'नाम और दिए गए पैसे से मिलान करता है। ऑफर में शामिल होने से पहले की खरीद ' +
          'नहीं मिलती। किसी दूसरे शॉपिंग खाते की खरीद भी नहीं मिलती। आप ऑर्डर के पेज ' +
          'की फोटो भेज सकते हैं, कोई व्यक्ति उसे देख लेगा।',
        phrases: ['ऑर्डर नहीं मिला', 'ऑर्डर क्यों नहीं दिख रहा'],
      },
      'hi-en': {
        title: 'Humein aapka order nahi mila',
        body:
          'App aapke phone par aapke apne order ke page dekhkar kharid dhoondta ' +
          'hai. Yeh saman ke naam aur diye gaye paise se milan karta hai. Offer ' +
          'mein shamil hone se pehle ki kharid nahi milti. Kisi dusre shopping ' +
          'khate ki kharid bhi nahi milti. Aap order ke page ki photo bhej sakte ' +
          'hain, koi vyakti use dekh lega.',
        phrases: ['order nahi mila', 'order kyun nahi dikh raha'],
      },
    },
  },
  {
    key: 'review-not-found',
    topic: 'review',
    drawnFrom:
      'src/ui/support.js help subject "My review is not being detected", explained with the terms section "What Fayr is"',
    wordings: {
      en: {
        title: 'We cannot see your review yet',
        body:
          'Your review has to be showing on the product page itself. Shops often ' +
          'take a few days to put a new review up. Until it is showing there, we ' +
          'have nothing to see. Check that it is on the same product you joined ' +
          'the offer for. You can also send us a picture of it, and a person will ' +
          'check.',
        phrases: [
          'my review is not being detected',
          'you cannot see my review',
          'review not showing',
          'i already wrote my review',
        ],
      },
      hi: {
        title: 'हमें आपका रिव्यू अभी नहीं दिख रहा',
        body:
          'आपका रिव्यू सामान के पेज पर दिखना ज़रूरी है। दुकानें अक्सर नया रिव्यू ' +
          'लगाने में कुछ दिन लेती हैं। जब तक वह वहाँ नहीं दिखता, हमें कुछ नहीं ' +
          'दिखता। देख लें कि वह उसी सामान पर है जिसका ऑफर आपने लिया था। आप उसकी ' +
          'फोटो भी भेज सकते हैं, कोई व्यक्ति देख लेगा।',
        phrases: ['रिव्यू नहीं दिख रहा', 'रिव्यू लिख दिया है'],
      },
      'hi-en': {
        title: 'Humein aapka review abhi nahi dikh raha',
        body:
          'Aapka review saman ke page par dikhna zaroori hai. Dukaanein aksar naya ' +
          'review lagane mein kuch din leti hain. Jab tak wo wahan nahi dikhta, ' +
          'humein kuch nahi dikhta. Dekh lein ki wo usi saman par hai jiska offer ' +
          'aapne liya tha. Aap uski photo bhi bhej sakte hain, koi vyakti dekh ' +
          'lega.',
        phrases: ['review nahi dikh raha', 'review likh diya hai'],
      },
    },
  },
  {
    key: 'withdrawal-problem',
    topic: 'withdrawal',
    drawnFrom:
      'src/ui/support.js help subject "A problem with my withdrawal", explained with the terms section "Your wallet and withdrawals"',
    wordings: {
      en: {
        title: 'Something went wrong taking money out',
        body:
          'Every request to take money out is checked by a person from Fayr before ' +
          'it is sent. While it is being checked, the money is held and you will ' +
          'see it on your wallet screen. If a request is turned down or the send ' +
          'fails, the money goes straight back to your wallet. It is never lost.',
        phrases: [
          'a problem with my withdrawal',
          'my withdrawal failed',
          'my withdrawal is stuck',
          'money left my wallet but did not arrive',
        ],
      },
      hi: {
        title: 'पैसा निकालने में कुछ गड़बड़ हुई',
        body:
          'पैसा भेजने से पहले हर अनुरोध को फेयर का कोई व्यक्ति देखता है। जब तक जाँच ' +
          'चल रही है, पैसा रुका रहता है और आपको वॉलेट के पेज पर दिखता है। अगर ' +
          'अनुरोध मना हो जाए या भेजना असफल हो, तो पैसा सीधे वॉलेट में वापस आ जाता ' +
          'है। पैसा कभी खोता नहीं है।',
        phrases: ['पैसा निकालने में दिक्कत', 'निकाला हुआ पैसा नहीं आया'],
      },
      'hi-en': {
        title: 'Paisa nikalne mein kuch gadbad hui',
        body:
          'Paisa bhejne se pehle har anurodh ko Fayr ka koi vyakti dekhta hai. Jab ' +
          'tak jaanch chal rahi hai, paisa ruka rehta hai aur aapko wallet ke page ' +
          'par dikhta hai. Agar anurodh mana ho jaye ya bhejna asafal ho, to paisa ' +
          'seedhe wallet mein wapas aa jata hai. Paisa kabhi khota nahi hai.',
        phrases: ['paisa nikalne mein dikkat', 'nikala hua paisa nahi aaya'],
      },
    },
  },
  {
    key: 'what-the-app-reads',
    topic: 'privacy',
    drawnFrom:
      'src/ui/policy.js, privacy section "What we read from a marketplace"',
    wordings: {
      en: {
        title: 'What the app reads from a shop',
        body:
          'When you connect a shopping account, the app reads only your own order ' +
          'pages and review pages. It does that on your phone. It reads them to ' +
          'confirm the buy, the day it arrived, and that your review is live. It ' +
          'does not read your messages. It does not read your cards. It does not ' +
          'read anything you did not join an offer for.',
        phrases: [
          'what does the app read',
          'can you see my messages',
          'what do you look at on amazon',
          'is the app safe',
        ],
      },
      hi: {
        title: 'ऐप दुकान से क्या पढ़ता है',
        body:
          'जब आप शॉपिंग खाता जोड़ते हैं, ऐप सिर्फ आपके अपने ऑर्डर और रिव्यू के पेज ' +
          'पढ़ता है। यह आपके फोन पर ही होता है। यह खरीद, सामान आने का दिन, और रिव्यू ' +
          'दिख रहा है या नहीं, यही देखता है। यह आपके मैसेज नहीं पढ़ता। आपके कार्ड ' +
          'नहीं पढ़ता। जिस चीज़ का ऑफर नहीं लिया, वह भी नहीं पढ़ता।',
        phrases: ['ऐप क्या पढ़ता है', 'मेरे मैसेज दिखते हैं क्या'],
      },
      'hi-en': {
        title: 'App dukaan se kya padhta hai',
        body:
          'Jab aap shopping khata jodte hain, app sirf aapke apne order aur review ' +
          'ke page padhta hai. Yeh aapke phone par hi hota hai. Yeh kharid, saman ' +
          'aane ka din, aur review dikh raha hai ya nahi, yahi dekhta hai. Yeh ' +
          'aapke message nahi padhta. Aapke card nahi padhta. Jis cheez ka offer ' +
          'nahi liya, wo bhi nahi padhta.',
        phrases: ['app kya padhta hai', 'mere message dikhte hain kya'],
      },
    },
  },
  {
    key: 'we-never-see-your-shop-password',
    topic: 'privacy',
    drawnFrom:
      'src/ui/policy.js, privacy section "We never see your marketplace password"',
    wordings: {
      en: {
        title: 'We never see your shop password',
        body:
          'You sign in to the shop on the shop’s own page. Fayr never receives ' +
          'that password, never keeps it, and never sends it anywhere. We will ' +
          'never ask you for it. We will never ask you for a one-time code. We ' +
          'will never ask for your PAN anywhere except the screen where you set up ' +
          'getting paid.',
        phrases: [
          'do you know my amazon password',
          'is my password safe',
          'someone asked me for my password',
          'why do you need me to log in',
        ],
      },
      hi: {
        title: 'हम आपका दुकान का पासवर्ड कभी नहीं देखते',
        body:
          'आप दुकान के अपने पेज पर ही साइन इन करते हैं। फेयर को वह पासवर्ड कभी नहीं ' +
          'मिलता, हम उसे रखते नहीं, और कहीं भेजते नहीं। हम आपसे वह कभी नहीं ' +
          'माँगेंगे। हम आपसे कोई एक बार वाला कोड कभी नहीं माँगेंगे। पैन भी सिर्फ ' +
          'पैसे लेने वाले पेज पर ही माँगा जाता है।',
        phrases: ['मेरा पासवर्ड सुरक्षित है', 'पासवर्ड आपको दिखता है क्या'],
      },
      'hi-en': {
        title: 'Hum aapka dukaan ka password kabhi nahi dekhte',
        body:
          'Aap dukaan ke apne page par hi sign in karte hain. Fayr ko wo password ' +
          'kabhi nahi milta, hum use rakhte nahi, aur kahin bhejte nahi. Hum aapse ' +
          'wo kabhi nahi maangenge. Hum aapse koi ek baar wala code kabhi nahi ' +
          'maangenge. PAN bhi sirf paise lene wale page par hi manga jata hai.',
        phrases: [
          'mera password surakshit hai',
          'password aapko dikhta hai kya',
        ],
      },
    },
  },
  {
    key: 'what-we-store',
    topic: 'privacy',
    drawnFrom: 'src/ui/policy.js, privacy section "What we store"',
    wordings: {
      en: {
        title: 'What Fayr keeps about you',
        body:
          'We keep your mobile number, the offers you join, and the order and ' +
          'review details we checked. We keep your wallet and ticket history, and ' +
          'the details you gave us for getting paid. We keep those last ones so we ' +
          'can pay you, and so one person cannot hold several accounts.',
        phrases: [
          'what data do you keep',
          'what do you store about me',
          'why do you keep my details',
        ],
      },
      hi: {
        title: 'फेयर आपके बारे में क्या रखता है',
        body:
          'हम आपका मोबाइल नंबर, आपके लिए हुए ऑफर, और जाँचे गए ऑर्डर और रिव्यू की ' +
          'जानकारी रखते हैं। हम आपके वॉलेट और टिकट का हिसाब भी रखते हैं। पैसे लेने ' +
          'की जानकारी भी रखते हैं। यह इसलिए कि हम आपको पैसा भेज सकें, और एक व्यक्ति ' +
          'कई खाते न रख सके।',
        phrases: ['आप क्या जानकारी रखते हैं', 'मेरी जानकारी क्यों रखते हैं'],
      },
      'hi-en': {
        title: 'Fayr aapke baare mein kya rakhta hai',
        body:
          'Hum aapka mobile number, aapke liye hue offer, aur jaanche gaye order ' +
          'aur review ki jankari rakhte hain. Hum aapke wallet aur ticket ka hisab ' +
          'bhi rakhte hain. Paise lene ki jankari bhi rakhte hain. Yeh isliye ki ' +
          'hum aapko paisa bhej sakein, aur ek vyakti kai khate na rakh sake.',
        phrases: [
          'aap kya jankari rakhte hain',
          'meri jankari kyun rakhte hain',
        ],
      },
    },
  },
  {
    key: 'screenshots-are-private',
    topic: 'privacy',
    drawnFrom: 'src/ui/policy.js, privacy section "Screenshots you send us"',
    wordings: {
      en: {
        title: 'Pictures you send us stay private',
        body:
          'A picture you send as proof is private. It is not put anywhere anybody ' +
          'can see. Only Fayr staff looking at your claim can open it. Every time ' +
          'a member of staff opens one, that is written down.',
        phrases: [
          'is my screenshot private',
          'who sees the picture i sent',
          'what happens to my screenshot',
        ],
      },
      hi: {
        title: 'आपकी भेजी फोटो निजी रहती है',
        body:
          'सबूत के लिए भेजी गई फोटो निजी रहती है। इसे कहीं भी सबके सामने नहीं रखा ' +
          'जाता। सिर्फ आपका दावा देख रहे फेयर के लोग ही इसे खोल सकते हैं। जब भी कोई ' +
          'इसे खोलता है, वह लिख लिया जाता है।',
        phrases: ['मेरी फोटो निजी है क्या', 'फोटो कौन देखता है'],
      },
      'hi-en': {
        title: 'Aapki bheji photo niji rehti hai',
        body:
          'Saboot ke liye bheji gayi photo niji rehti hai. Ise kahin bhi sabke ' +
          'samne nahi rakha jata. Sirf aapka dava dekh rahe Fayr ke log hi ise ' +
          'khol sakte hain. Jab bhi koi ise kholta hai, wo likh liya jata hai.',
        phrases: ['meri photo niji hai kya', 'photo kaun dekhta hai'],
      },
    },
  },
  {
    key: 'who-else-sees-my-details',
    topic: 'privacy',
    drawnFrom: 'src/ui/policy.js, privacy section "Who else sees it"',
    wordings: {
      en: {
        title: 'Who else sees your details',
        body:
          'We do not sell your details. We do not give them to the shops. We only ' +
          'pass on what the company sending your money needs, and whatever the law ' +
          'says we must.',
        phrases: [
          'do you sell my data',
          'who else sees my details',
          'does amazon know i use fayr',
        ],
      },
      hi: {
        title: 'आपकी जानकारी और कौन देखता है',
        body:
          'हम आपकी जानकारी बेचते नहीं हैं। हम इसे दुकानों को नहीं देते। हम सिर्फ ' +
          'उतना बताते हैं जितना पैसा भेजने वाली कंपनी को चाहिए, और जितना कानून कहता ' +
          'है।',
        phrases: ['मेरी जानकारी बेचते हैं क्या', 'और कौन देखता है'],
      },
      'hi-en': {
        title: 'Aapki jankari aur kaun dekhta hai',
        body:
          'Hum aapki jankari bechte nahi hain. Hum ise dukaano ko nahi dete. Hum ' +
          'sirf utna batate hain jitna paisa bhejne wali company ko chahiye, aur ' +
          'jitna kanoon kehta hai.',
        phrases: ['meri jankari bechte hain kya', 'aur kaun dekhta hai'],
      },
    },
  },
  {
    key: 'delete-my-account',
    topic: 'account',
    drawnFrom: 'src/ui/policy.js, privacy section "Your choices"',
    wordings: {
      en: {
        title: 'Getting a copy of your details, or closing your account',
        body:
          'You can ask us for a copy of what we hold about you. You can ask us to ' +
          'close your account. Both are asked for from the Help screen. Some ' +
          'records have to be kept as long as the law says, even after an account ' +
          'is closed. Money already paid to you is one of those.',
        phrases: [
          'how do i delete my account',
          'i want to close my account',
          'can i get a copy of my data',
          'delete my data',
        ],
      },
      hi: {
        title: 'अपनी जानकारी की नकल लेना, या खाता बंद करना',
        body:
          'आप हमसे अपनी जानकारी की एक नकल माँग सकते हैं। आप खाता बंद करने को भी कह ' +
          'सकते हैं। दोनों बातें हेल्प के पेज से कही जाती हैं। कुछ रिकॉर्ड कानून के ' +
          'कहे अनुसार रखने पड़ते हैं, खाता बंद होने के बाद भी। दिया जा चुका पैसा उनमें ' +
          'से एक है।',
        phrases: ['खाता कैसे बंद करें', 'मेरी जानकारी हटा दें'],
      },
      'hi-en': {
        title: 'Apni jankari ki nakal lena, ya khata band karna',
        body:
          'Aap humse apni jankari ki ek nakal maang sakte hain. Aap khata band ' +
          'karne ko bhi keh sakte hain. Dono baatein Help ke page se kahi jati ' +
          'hain. Kuch record kanoon ke kahe anusar rakhne padte hain, khata band ' +
          'hone ke baad bhi. Diya ja chuka paisa unme se ek hai.',
        phrases: ['khata kaise band karein', 'meri jankari hata dein'],
      },
    },
  },

  {
    key: 'offer-will-not-open',
    topic: 'order',
    drawnFrom:
      'The greyed-out states in src/live-check/live-page.rules.ts, which are the only reasons Fayr ever hides an offer, and the terms section "What Fayr is".',
    wordings: {
      en: {
        title: 'An offer will not open, or has gone grey',
        body:
          'A grey offer is one you cannot join right now. Either all its places ' +
          'are taken, or the shop\u2019s own page for it has stopped working. The ' +
          'grey card says which. It stays on your list on purpose, so you can see ' +
          'it is still there. These often come back, so it is worth looking again.',
        phrases: [
          'why is this offer grey',
          'the offer will not open',
          'the shop page is not working',
          'why can i not join this offer',
          'this offer has disappeared',
        ],
      },
      hi: {
        title: 'ऑफर नहीं खुल रहा, या धुँधला हो गया है',
        body:
          'धुँधला ऑफर वह है जिसमें आप अभी शामिल नहीं हो सकते। या तो उसकी सारी जगहें ' +
          'भर गई हैं, या दुकान का उसका पेज काम करना बंद कर चुका है। धुँधले कार्ड पर ' +
          'लिखा होता है कि कारण क्या है। वह आपकी सूची में जान‑बूझकर बना रहता है, ' +
          'ताकि आप देख सकें कि वह अब भी है। ये अक्सर वापस आ जाते हैं, इसलिए फिर से ' +
          'देखना अच्छा रहता है।',
        phrases: ['ऑफर धुँधला क्यों है', 'ऑफर नहीं खुल रहा', 'ऑफर गायब हो गया'],
      },
      'hi-en': {
        title: 'Offer nahi khul raha, ya dhundhla ho gaya hai',
        body:
          'Dhundhla offer wo hai jisme aap abhi shamil nahi ho sakte. Ya to uski ' +
          'saari jagahein bhar gayi hain, ya dukaan ka uska page kaam karna band ' +
          'kar chuka hai. Dhundhle card par likha hota hai ki karan kya hai. Wo ' +
          'aapki suchi mein jaan boojhkar bana rehta hai, taki aap dekh sakein ki ' +
          'wo ab bhi hai. Ye aksar wapas aa jate hain, isliye phir se dekhna accha ' +
          'rehta hai.',
        phrases: [
          'offer dhundhla kyun hai',
          'offer nahi khul raha',
          'offer gayab ho gaya',
        ],
      },
    },
  },

  // ── the four where the project has never written the answer down ────────
  {
    key: 'how-long-does-a-refund-take',
    topic: 'refund',
    needsARealAnswer: true,
    drawnFrom:
      'The steps are from the terms section "The waiting period". HOW LONG each step takes is not written down anywhere in this project.',
    wordings: {
      en: {
        title: 'How long the whole thing takes',
        body:
          `The steps are set. Your order is matched, the product arrives, your ` +
          `review shows, and then we wait for the shop’s return time. How many ` +
          `days that adds up to depends on the shop and the product. ` +
          OVER_TO_A_PERSON.en,
        phrases: [
          'how long does it take',
          'how many days for the refund',
          'when exactly will i be paid',
        ],
      },
      hi: {
        title: 'पूरी प्रक्रिया में कितना समय लगता है',
        body:
          'कदम तय हैं। ऑर्डर मिलाया जाता है, सामान आता है, रिव्यू दिखता है, फिर हम ' +
          'दुकान के वापसी के समय का इंतज़ार करते हैं। कुल कितने दिन लगेंगे, यह दुकान ' +
          'और सामान पर निर्भर करता है। ' +
          OVER_TO_A_PERSON.hi,
        phrases: ['कितना समय लगता है', 'कितने दिन में पैसा आएगा'],
      },
      'hi-en': {
        title: 'Puri prakriya mein kitna samay lagta hai',
        body:
          'Kadam tay hain. Order milaya jata hai, saman aata hai, review dikhta ' +
          'hai, phir hum dukaan ke wapsi ke samay ka intezaar karte hain. Kul ' +
          'kitne din lagenge, yeh dukaan aur saman par nirbhar karta hai. ' +
          OVER_TO_A_PERSON['hi-en'],
        phrases: ['kitna samay lagta hai', 'kitne din mein paisa aayega'],
      },
    },
  },
  {
    key: 'how-long-does-a-withdrawal-take',
    topic: 'withdrawal',
    needsARealAnswer: true,
    drawnFrom:
      'The check by a person is from the terms section "Your wallet and withdrawals". HOW LONG the money then takes to arrive is not written down anywhere.',
    wordings: {
      en: {
        title: 'How long money takes to reach your bank',
        body:
          'A person from Fayr checks your request first. After that the money is ' +
          'sent to the UPI or bank account you gave us. How long it then takes to ' +
          'show up is not something we have put in writing. ' +
          OVER_TO_A_PERSON.en,
        phrases: [
          'how long does a withdrawal take',
          'when will the money reach my bank',
          'how many days for withdrawal',
        ],
      },
      hi: {
        title: 'पैसा बैंक तक पहुँचने में कितना समय लगता है',
        body:
          'पहले फेयर का कोई व्यक्ति आपका अनुरोध देखता है। उसके बाद पैसा आपके दिए गए ' +
          'यूपीआई या बैंक खाते में भेजा जाता है। उसके बाद कितने समय में दिखेगा, यह ' +
          'हमने लिखा नहीं है। ' +
          OVER_TO_A_PERSON.hi,
        phrases: ['पैसा कितने दिन में आएगा', 'बैंक में कब आएगा'],
      },
      'hi-en': {
        title: 'Paisa bank tak pahunchne mein kitna samay lagta hai',
        body:
          'Pehle Fayr ka koi vyakti aapka anurodh dekhta hai. Uske baad paisa aapke ' +
          'diye gaye UPI ya bank khate mein bheja jata hai. Uske baad kitne samay ' +
          'mein dikhega, yeh humne likha nahi hai. ' +
          OVER_TO_A_PERSON['hi-en'],
        phrases: ['paisa kitne din mein aayega', 'bank mein kab aayega'],
      },
    },
  },
  {
    key: 'does-fayr-cost-anything',
    topic: 'about',
    needsARealAnswer: true,
    drawnFrom:
      'src/ui/policy.js terms section "Tickets" for the ticket rule. Whether Fayr charges a fee, and how Fayr earns, is not written down anywhere in this project.',
    wordings: {
      en: {
        title: 'Does Fayr charge you anything',
        body:
          'The only thing you spend here is tickets, and tickets are not money. ' +
          'Whether there is any charge at all, and how Fayr earns, is not written ' +
          'down in the app yet. ' +
          OVER_TO_A_PERSON.en,
        phrases: [
          'does fayr charge a fee',
          'is fayr free',
          'how does fayr make money',
          'do i have to pay anything',
        ],
      },
      hi: {
        title: 'क्या फेयर कुछ पैसा लेता है',
        body:
          'यहाँ आप सिर्फ टिकट खर्च करते हैं, और टिकट पैसा नहीं हैं। कोई शुल्क है या ' +
          'नहीं, और फेयर कैसे कमाता है, यह अभी ऐप में लिखा नहीं है। ' +
          OVER_TO_A_PERSON.hi,
        phrases: ['फेयर मुफ्त है क्या', 'कोई फीस है क्या'],
      },
      'hi-en': {
        title: 'Kya Fayr kuch paisa leta hai',
        body:
          'Yahan aap sirf ticket kharch karte hain, aur ticket paisa nahi hain. ' +
          'Koi shulk hai ya nahi, aur Fayr kaise kamata hai, yeh abhi app mein ' +
          'likha nahi hai. ' +
          OVER_TO_A_PERSON['hi-en'],
        phrases: ['fayr muft hai kya', 'koi fees hai kya'],
      },
    },
  },
  {
    key: 'talk-to-a-person',
    topic: 'about',
    needsARealAnswer: true,
    drawnFrom:
      'The Help screen exists in src/SupportScreen.js. Opening hours, a phone number and how quickly somebody replies are not written down anywhere.',
    wordings: {
      en: {
        title: 'Talking to a real person',
        body:
          'You can write to us from the Help screen, and a person from Fayr reads ' +
          'it. What hours we are here, and how quickly somebody replies, is not ' +
          'written down yet. ' +
          OVER_TO_A_PERSON.en,
        phrases: [
          'i want to talk to a person',
          'how do i contact support',
          'is there a phone number',
          'when will someone reply',
        ],
      },
      hi: {
        title: 'किसी व्यक्ति से बात करना',
        body:
          'आप हेल्प के पेज से हमें लिख सकते हैं, और फेयर का कोई व्यक्ति उसे पढ़ता है। ' +
          'हम किस समय उपलब्ध हैं, और जवाब कितनी जल्दी आता है, यह अभी लिखा नहीं है। ' +
          OVER_TO_A_PERSON.hi,
        phrases: ['किसी से बात करनी है', 'फोन नंबर है क्या'],
      },
      'hi-en': {
        title: 'Kisi vyakti se baat karna',
        body:
          'Aap Help ke page se humein likh sakte hain, aur Fayr ka koi vyakti use ' +
          'padhta hai. Hum kis samay uplabdh hain, aur jawab kitni jaldi aata hai, ' +
          'yeh abhi likha nahi hai. ' +
          OVER_TO_A_PERSON['hi-en'],
        phrases: ['kisi se baat karni hai', 'phone number hai kya'],
      },
    },
  },
];

/** Every language each draft is written in. */
export const DRAFT_LANGUAGES: DraftLanguage[] = ['en', 'hi', 'hi-en'];

/** The ones a person still has to give a real answer for. */
export function draftsNeedingARealAnswer(): AnswerDraftSet[] {
  return ANSWER_DRAFTS.filter((d) => d.needsARealAnswer === true);
}
