// Translations: English, Konkani (gom), Hindi (hi), Marathi (mr).
// Fully translated: navigation, hospital cards + filters, the emergency screen and the whole symptom-triage flow.
// Other screens (staff dashboard, appointment forms, insurance calculators) fall back to English for now.
//
// >>> REVIEW NEEDED <<<  The Konkani, Hindi and Marathi strings were machine-translated and have NOT been checked by a native
// speaker. The app shows a notice about this whenever a non-English language is selected. Medical wording in particular
// (the a_* triage advice) must be reviewed before any real-world use.  To fix a string, edit it below and nothing else.
(function () {
    const I18N = {
        en: {
            navHome: 'Dashboard', subtitle: 'Goa Health & Emergency Portal', navAppt: 'Appointments', navDoc: 'Doctors Status', navFac: 'Hospitals & Beds', navRecords: 'Medical History Report',
            navStore: 'Medical Stores Nearby', navDdssy: 'DDSSY & Insurance', navSos: 'Symptom Triage & SOS', navProfile: 'User Profile', navStaff: 'Staff Dashboard', navAdmin: 'Administration',
            titleHospitals: 'Hospitals & Bed Availability in Goa', subHospitals: 'Bed counts come from hospital staff. Tap a card for the Google Maps route or to call.',
            mtNotice: 'Machine-translated text, pending review by a native speaker. In an emergency, call 108.',
            searchPh: 'Search facility name or locality...', allRegions: 'All Regions', allTypes: 'All Hospital Types', optPublic: 'Public / Government', optPrivate: 'Private Empaneled', optSuper: 'Super Specialty',
            loading: 'Loading live hospital data from the server...',
            'ct_Public': 'Public', 'ct_Private': 'Private', 'ct_Super Specialty': 'Super Specialty', 'd_North Goa': 'North Goa', 'd_South Goa': 'South Goa',
            liveBeds: 'Bed availability', updated: 'Updated', bICU: 'ICU', bOxygen: 'Oxygen', bGeneral: 'General',
            staffVerified: 'Updated by hospital staff', staffUnverified: 'Not yet confirmed by the hospital. Numbers may be old.',
            mapRoute: 'Google Maps Route', callHospital: 'Call hospital', phoneNA: 'Hospital phone not verified. Use the 104 helpline.',
            reportWait: 'Report current wait', crowdLabel: 'Crowd', cr_low: 'Low', cr_moderate: 'Moderate', cr_high: 'High', cr_veryHigh: 'Very crowded', cr_none: 'No live data yet',
            altTitle: 'Less crowded options nearby', altKm: '{n} km', altGo: 'Go here instead',
            emTitle: 'Goa 108 Emergency Ambulance', em247: '24x7 Response', emDesc: 'Free emergency ambulance across Goa. Call first, then follow the triage steps below.',
            call108: 'Call 108 Ambulance', call104: '104 Health Helpline', emOffline: 'The 108 and 104 buttons work without internet.', emLast: 'Last known hospitals (saved on this phone)', emLastNone: 'No hospital list saved yet. Open the app once with internet.',
            trTitle: 'Quick Symptom Triage', trIntro: 'Tap the main problem. You get a red / amber / green priority and the nearest hospital that has the right bed free right now.',
            trDisclaimer: 'Decision support only. This is not a diagnosis and does not replace a doctor. If you think it is an emergency, call 108.',
            trWhere: 'Or describe it in your own words', trWherePh: 'e.g. chest pain, fever for 3 days', trSpeak: 'Speak', trGo: 'Check', trNoMatch: 'Could not match that. Tap one of the buttons above.',
            s_chest_pain: 'Severe Chest Pain', s_trauma: 'Fracture / Trauma', s_maternity: 'Maternity / Labor', s_fever: 'High Fever / Dengue', s_stroke: 'Numbness / Stroke', s_breath: 'Breathing Distress', s_minor: 'Cough / Cold / Mild',
            lvl_red: 'RED: Emergency', lvl_amber: 'AMBER: See a doctor today', lvl_green: 'GREEN: OPD visit is fine',
            a_chest_pain: 'Possible heart emergency. Call 108 now. Keep still, sit upright, loosen tight clothes. Do not drive yourself.',
            a_stroke: 'Possible stroke (face drooping, arm weakness, speech trouble). Note the time it started and call 108 now. Give no food or drink.',
            a_breath: 'Severe breathlessness. Call 108 now. Sit upright, loosen clothes, stay calm. Use a prescribed inhaler or oxygen if you have it.',
            a_maternity: 'Labour or pregnancy emergency. Go now to a hospital with a maternity ward. Call 108 for bleeding, pain with water breaking, or if the baby is coming. Carry your pregnancy records.',
            a_trauma: 'Injury or suspected fracture. Do not move the injured limb or neck. Press firmly on any bleeding. Call 108 for heavy bleeding, head injury or a road accident.',
            a_fever: 'High fever needs a doctor today. Go sooner if there is severe headache, rash, bleeding gums, vomiting, belly pain or drowsiness (possible dengue warning signs). Drink plenty of fluids.',
            a_minor: 'Mild symptoms can usually wait for an OPD visit. A public facility with a low crowd is shown below. If you get worse, use the other buttons.',
            trNearest: 'Nearest facility with a free {bed} bed right now', bed_icu: 'ICU', bed_oxygen: 'oxygen', bed_general: 'general',
            trKm: '{n} km away', trNoBeds: 'No listed facility has this bed free right now. Call 108 or go to the nearest emergency department.', trNoLoc: 'Location is off, so the list is not sorted by distance.',
            trRerouted: 'Sent to the nearest hospital with a free bed instead of defaulting to GMC Bambolim.', trFree: '{n} free', trDirections: 'Directions', trCall: 'Call', trBedsStaff: 'beds confirmed by hospital staff', trBedsOld: 'beds not yet confirmed by staff',
            trLoading: 'Finding the nearest hospital with a free bed...', trOffline: 'No connection. Call 108 now. The advice above works offline.', trUseLoc: 'Use my location'
        },
        gom: {
            navHome: 'डॅशबोर्ड', subtitle: 'गोंय भलायकी आनी आणीबाणी सेवा', navAppt: 'अपॉइंटमेंट', navDoc: 'डॉक्टर स्थिती', navFac: 'हॉस्पिटलां आनी खाटां', navRecords: 'वैद्यकीय इतिहास', navStore: 'लागींचीं औशदां दुकानां',
            navDdssy: 'DDSSY आनी विमो', navSos: 'लक्षणां आनी SOS', navProfile: 'वापरपी प्रोफाइल', navStaff: 'कर्मचारी डॅशबोर्ड',
            titleHospitals: 'गोंयांतलीं हॉस्पिटलां आनी खाटांची स्थिती', subHospitals: 'खाटांचे आकडे हॉस्पिटलाचे कर्मचारी दितात. गुगल म्हापाचो मार्ग घेवपाक वा फोन करपाक कार्डाचेर टॅप करात.',
            mtNotice: 'यंत्रान केल्लें भाषांतर, मूळ भाशिकाकडल्यान तपासपाचें बाकी आसा. आणीबाणींत 108 क्रमांकाचेर फोन करात.',
            searchPh: 'हॉस्पिटलाचें नांव वा वसाहत सोदात...', allRegions: 'सगळे विभाग', allTypes: 'सगळे हॉस्पिटल प्रकार', optPublic: 'सरकारी', optPrivate: 'खासगी (एम्पॅनल्ड)', optSuper: 'सुपर स्पेशालिटी',
            loading: 'सर्वरावयल्यान हॉस्पिटलांची थेट म्हायती भरता आसा...',
            'ct_Public': 'सरकारी', 'ct_Private': 'खासगी', 'ct_Super Specialty': 'सुपर स्पेशालिटी', 'd_North Goa': 'उत्तर गोंय', 'd_South Goa': 'दक्षिण गोंय',
            liveBeds: 'खाटांची उपलब्धताय', updated: 'नवीन केलें', bICU: 'आयसीयू', bOxygen: 'ऑक्सिजन', bGeneral: 'सामान्य',
            staffVerified: 'हॉस्पिटलाच्या कर्मचाऱ्यांनी नवीन केलें', staffUnverified: 'हॉस्पिटलान अजून पडताळून पळयलें ना. आकडे जुने आसूं शकतात.',
            mapRoute: 'गुगल म्हापाचो मार्ग', callHospital: 'हॉस्पिटलाक फोन करात', phoneNA: 'हॉस्पिटलाचो फोन क्रमांक पडताळिल्लो ना. 104 हेल्पलायन वापरात.',
            reportWait: 'सद्याचो वेळ सांगात', crowdLabel: 'गर्दी', cr_low: 'कमी', cr_moderate: 'मध्यम', cr_high: 'चड', cr_veryHigh: 'खूब गर्दी', cr_none: 'अजून थेट म्हायती ना',
            altTitle: 'लागीं कमी गर्दीचे पर्याय', altKm: '{n} किमी', altGo: 'हांगा वचात',
            emTitle: 'गोंय 108 आणीबाणी रुग्णवाहिका', em247: '24x7 सेवा', emDesc: 'सगळ्या गोंयांत मोफत आणीबाणी रुग्णवाहिका. पयलें फोन करात, मागीर सकयल दिल्ले टप्पे पाळात.',
            call108: '108 रुग्णवाहिकेक फोन करात', call104: '104 आरोग्य हेल्पलायन', emOffline: '108 आनी 104 बटणां इंटरनेटाविना चालतात.', emLast: 'निमाणीं म्हायती आशिल्लीं हॉस्पिटलां (ह्या फोनार सांठयल्यांत)', emLastNone: 'अजून हॉस्पिटलांची यादी सांठयल्या ना. इंटरनेट आसतना अॅप एकदां उगडात.',
            trTitle: 'लक्षणांची जल्दी तपासणी', trIntro: 'मुखेल त्रासाचेर टॅप करात. तुमकां तांबडो / पिंवळो / हिरवो अग्रक्रम आनी आता योग्य खाट मोकळी आशिल्लें लागीचें हॉस्पिटल मेळटा.',
            trDisclaimer: 'फकत निर्णयाक आदार. हें निदान न्हय आनी डॉक्टराची जागा घेना. आणीबाणी आसूं येता अशें दिसल्यार 108 क्रमांकाचेर फोन करात.',
            trWhere: 'वा तुमच्या सबदांनी सांगात', trWherePh: 'उदा. छातींत दुखप, 3 दिसांचो ताप', trSpeak: 'उलयात', trGo: 'तपासात', trNoMatch: 'हें समजलें ना. वयली एक बटणां दाबात.',
            s_chest_pain: 'छातींत जायत दुखप', s_trauma: 'हाड मोडप / इजा', s_maternity: 'प्रसूती / वेणा', s_fever: 'चड ताप / डेंग्यू', s_stroke: 'बधिरताय / पक्षाघात', s_breath: 'श्वास घेवपाक त्रास', s_minor: 'खोंक / सर्दी / सौम्य',
            lvl_red: 'तांबडो: आणीबाणी', lvl_amber: 'पिंवळो: आयज डॉक्टराक दाखयात', lvl_green: 'हिरवो: OPD भेट पुरो',
            a_chest_pain: 'हृदयाची आणीबाणी आसूं येता. आतांच 108 क्रमांकाचेर फोन करात. स्थीर रावात, सरळ बसात, घट्ट कपडे सैल करात. स्वता गाडी चलयनाकात.',
            a_stroke: 'पक्षाघात आसूं येता (तोंड वाकडें जावप, हात दुबळो जावप, उलोवपाक त्रास). कितें वेळार सुरू जालें तें लक्षांत दवरात आनी आतांच 108 क्रमांकाचेर फोन करात. खावपाक वा पियेवपाक दिवं नाकात.',
            a_breath: 'चड श्वासाचो त्रास. आतांच 108 क्रमांकाचेर फोन करात. सरळ बसात, कपडे सैल करात, शांत रावात. डॉक्टरान सांगिल्लो इनहेलर वा ऑक्सिजन आसल्यार वापरात.',
            a_maternity: 'प्रसूती वा गर्भारपणाची आणीबाणी. आतां प्रसूती विभाग आशिल्ल्या हॉस्पिटलांत वचात. रगत वता, पाणी फुटून दुखता वा बाळ येता जाल्यार 108 क्रमांकाचेर फोन करात. गर्भारपणाचे कागदपत्र वांगडा व्हरात.',
            a_trauma: 'इजा वा हाड मोडल्लें अशें दिसता. इजा जाल्लो अवयव वा मान हालयनाकात. रगत वताच्या जाग्यार घट्ट दाबात. चड रगत वता, डोक्याक इजा वा रस्त्यावयली अपघात जाल्यार 108 क्रमांकाचेर फोन करात.',
            a_fever: 'चड तापाक आयज डॉक्टराची गरज आसा. तीव्र डोकें दुखप, पुरळ, हिरड्यांतल्यान रगत, वांती, पोट दुखप वा झोंप येवप (डेंग्यूचीं धोक्याचीं लक्षणां आसूं येतात) आसल्यार लवकर वचात. चड उदक पियेयात.',
            a_minor: 'सौम्य लक्षणां सामान्यपणान OPD भेटीची वाट पळयतात. कमी गर्दीचें सरकारी हॉस्पिटल सकयल दाखयला. चड वायट जाल्यार दुसरीं बटणां वापरात.',
            trNearest: 'आतां मोकळी {bed} खाट आशिल्लें लागीचें हॉस्पिटल', bed_icu: 'आयसीयू', bed_oxygen: 'ऑक्सिजन', bed_general: 'सामान्य',
            trKm: '{n} किमी पयस', trNoBeds: 'यादींतल्या कोणाकूच ही खाट आतां मोकळी ना. 108 क्रमांकाचेर फोन करात वा लागीच्या आणीबाणी विभागांत वचात.', trNoLoc: 'लोकेशन बंद आसा, देखून यादी अंतराप्रमाण लावल्या ना.',
            trRerouted: 'GMC बांबोळीक वचपा ऐवजी मोकळी खाट आशिल्ल्या लागीच्या हॉस्पिटलाक धाडलें.', trFree: '{n} मोकळ्यो', trDirections: 'मार्ग', trCall: 'फोन', trBedsStaff: 'खाटांची म्हायती हॉस्पिटलाच्या कर्मचाऱ्यांनी पडताळली', trBedsOld: 'खाटांची म्हायती कर्मचाऱ्यांनी अजून पडताळिल्ली ना',
            trLoading: 'मोकळी खाट आशिल्लें लागीचें हॉस्पिटल सोदता आसा...', trOffline: 'जोडणी ना. आतांच 108 क्रमांकाचेर फोन करात. वयली सल्लो इंटरनेटाविना चालता.', trUseLoc: 'म्हजें लोकेशन वापरात'
        },
        hi: {
            navHome: 'डैशबोर्ड', subtitle: 'गोवा स्वास्थ्य और आपातकालीन पोर्टल', navAppt: 'अपॉइंटमेंट', navDoc: 'डॉक्टरों की स्थिति', navFac: 'अस्पताल और बेड', navRecords: 'मेडिकल रिपोर्ट', navStore: 'पास की दवा दुकानें',
            navDdssy: 'DDSSY और बीमा', navSos: 'लक्षण जांच व एसओएस', navProfile: 'उपयोगकर्ता प्रोफ़ाइल', navStaff: 'स्टाफ डैशबोर्ड',
            titleHospitals: 'गोवा में अस्पताल और बेड की स्थिति', subHospitals: 'बेड की संख्या अस्पताल कर्मचारी देते हैं। गूगल मैप्स रूट या कॉल के लिए कार्ड पर टैप करें।',
            mtNotice: 'यह मशीन अनुवाद है और किसी मूल भाषी द्वारा जांचा जाना बाकी है। आपातकाल में 108 पर कॉल करें।',
            searchPh: 'अस्पताल का नाम या इलाका खोजें...', allRegions: 'सभी क्षेत्र', allTypes: 'सभी अस्पताल प्रकार', optPublic: 'सरकारी', optPrivate: 'निजी (एम्पैनल्ड)', optSuper: 'सुपर स्पेशलिटी',
            loading: 'सर्वर से अस्पतालों की लाइव जानकारी लोड हो रही है...',
            'ct_Public': 'सरकारी', 'ct_Private': 'निजी', 'ct_Super Specialty': 'सुपर स्पेशलिटी', 'd_North Goa': 'उत्तर गोवा', 'd_South Goa': 'दक्षिण गोवा',
            liveBeds: 'बेड की उपलब्धता', updated: 'अपडेट', bICU: 'आईसीयू', bOxygen: 'ऑक्सीजन', bGeneral: 'सामान्य',
            staffVerified: 'अस्पताल कर्मचारियों द्वारा अपडेट', staffUnverified: 'अस्पताल ने अभी पुष्टि नहीं की है। आंकड़े पुराने हो सकते हैं।',
            mapRoute: 'गूगल मैप्स रूट', callHospital: 'अस्पताल को कॉल करें', phoneNA: 'अस्पताल का फ़ोन नंबर सत्यापित नहीं है। 104 हेल्पलाइन का उपयोग करें।',
            reportWait: 'अभी का इंतज़ार बताएं', crowdLabel: 'भीड़', cr_low: 'कम', cr_moderate: 'मध्यम', cr_high: 'ज़्यादा', cr_veryHigh: 'बहुत भीड़', cr_none: 'अभी लाइव डेटा नहीं',
            altTitle: 'पास के कम भीड़ वाले विकल्प', altKm: '{n} किमी', altGo: 'यहाँ जाएं',
            emTitle: 'गोवा 108 आपातकालीन एम्बुलेंस', em247: '24x7 सेवा', emDesc: 'पूरे गोवा में निःशुल्क आपातकालीन एम्बुलेंस। पहले कॉल करें, फिर नीचे दिए चरणों का पालन करें।',
            call108: '108 एम्बुलेंस को कॉल करें', call104: '104 स्वास्थ्य हेल्पलाइन', emOffline: '108 और 104 बटन बिना इंटरनेट के काम करते हैं।', emLast: 'आखिरी ज्ञात अस्पताल (इस फ़ोन में सहेजे गए)', emLastNone: 'अभी कोई अस्पताल सूची सहेजी नहीं गई है। इंटरनेट के साथ ऐप एक बार खोलें।',
            trTitle: 'त्वरित लक्षण जांच', trIntro: 'मुख्य समस्या पर टैप करें। आपको लाल / पीला / हरा प्राथमिकता और अभी सही बेड खाली होने वाला सबसे नज़दीकी अस्पताल मिलेगा।',
            trDisclaimer: 'केवल निर्णय में सहायता। यह निदान नहीं है और डॉक्टर का विकल्प नहीं है। आपातकाल लगे तो 108 पर कॉल करें।',
            trWhere: 'या अपने शब्दों में बताएं', trWherePh: 'जैसे सीने में दर्द, 3 दिन से बुखार', trSpeak: 'बोलें', trGo: 'जांचें', trNoMatch: 'समझ नहीं आया। ऊपर दिए किसी बटन पर टैप करें।',
            s_chest_pain: 'सीने में तेज़ दर्द', s_trauma: 'फ्रैक्चर / चोट', s_maternity: 'प्रसव / मातृत्व', s_fever: 'तेज़ बुखार / डेंगू', s_stroke: 'सुन्नपन / स्ट्रोक', s_breath: 'सांस लेने में तकलीफ', s_minor: 'खांसी / सर्दी / हल्का',
            lvl_red: 'लाल: आपातकाल', lvl_amber: 'पीला: आज ही डॉक्टर को दिखाएं', lvl_green: 'हरा: OPD में जाना ठीक है',
            a_chest_pain: 'हृदय संबंधी आपातकाल हो सकता है। अभी 108 पर कॉल करें। स्थिर रहें, सीधे बैठें, तंग कपड़े ढीले करें। खुद गाड़ी न चलाएं।',
            a_stroke: 'स्ट्रोक हो सकता है (चेहरा टेढ़ा होना, हाथ में कमज़ोरी, बोलने में दिक्कत)। शुरू होने का समय नोट करें और अभी 108 पर कॉल करें। खाने-पीने को कुछ न दें।',
            a_breath: 'गंभीर सांस की तकलीफ। अभी 108 पर कॉल करें। सीधे बैठें, कपड़े ढीले करें, शांत रहें। डॉक्टर का बताया इनहेलर या ऑक्सीजन हो तो उपयोग करें।',
            a_maternity: 'प्रसव या गर्भावस्था की आपात स्थिति। तुरंत मातृत्व वार्ड वाले अस्पताल जाएं। रक्तस्राव, पानी की थैली फटने के साथ दर्द, या बच्चा आने पर 108 पर कॉल करें। गर्भावस्था के कागज़ साथ रखें।',
            a_trauma: 'चोट या फ्रैक्चर का शक। घायल अंग या गर्दन को न हिलाएं। खून बहने वाली जगह पर कसकर दबाएं। ज़्यादा खून बहने, सिर की चोट या सड़क दुर्घटना में 108 पर कॉल करें।',
            a_fever: 'तेज़ बुखार में आज ही डॉक्टर को दिखाएं। तेज़ सिरदर्द, दाने, मसूड़ों से खून, उल्टी, पेट दर्द या सुस्ती (डेंगू के संभावित चेतावनी लक्षण) हों तो जल्दी जाएं। खूब तरल पदार्थ पिएं।',
            a_minor: 'हल्के लक्षण आमतौर पर OPD तक रुक सकते हैं। कम भीड़ वाला सरकारी केंद्र नीचे दिखाया गया है। हालत बिगड़े तो दूसरे बटन इस्तेमाल करें।',
            trNearest: 'अभी {bed} बेड खाली होने वाली सबसे नज़दीकी सुविधा', bed_icu: 'आईसीयू', bed_oxygen: 'ऑक्सीजन', bed_general: 'सामान्य',
            trKm: '{n} किमी दूर', trNoBeds: 'सूची में किसी भी सुविधा में अभी यह बेड खाली नहीं है। 108 पर कॉल करें या नज़दीकी आपातकालीन विभाग जाएं।', trNoLoc: 'लोकेशन बंद है, इसलिए सूची दूरी के अनुसार नहीं है।',
            trRerouted: 'GMC बांबोलिम के बजाय खाली बेड वाले सबसे नज़दीकी अस्पताल भेजा गया।', trFree: '{n} खाली', trDirections: 'रास्ता', trCall: 'कॉल', trBedsStaff: 'बेड की जानकारी अस्पताल कर्मचारियों ने पुष्टि की', trBedsOld: 'बेड की जानकारी की स्टाफ ने अभी पुष्टि नहीं की',
            trLoading: 'खाली बेड वाला सबसे नज़दीकी अस्पताल खोजा जा रहा है...', trOffline: 'कनेक्शन नहीं है। अभी 108 पर कॉल करें। ऊपर की सलाह बिना इंटरनेट काम करती है।', trUseLoc: 'मेरा लोकेशन उपयोग करें'
        },
        mr: {
            navHome: 'डॅशबोर्ड', subtitle: 'गोवा आरोग्य आणि आणीबाणी सेवा', navAppt: 'अपॉइंटमेंट', navDoc: 'डॉक्टर स्थिती', navFac: 'रुग्णालये व खाटा', navRecords: 'वैद्यकीय अहवाल', navStore: 'जवळची औषध दुकाने',
            navDdssy: 'DDSSY अंदाज', navSos: 'लक्षणे व एसओएस', navProfile: 'वापरकर्ता प्रोफाइल', navStaff: 'कर्मचारी डॅशबोर्ड',
            titleHospitals: 'गोव्यातील रुग्णालये आणि खाटांची स्थिती', subHospitals: 'खाटांची संख्या रुग्णालयाचे कर्मचारी देतात. गुगल मॅप्स मार्ग किंवा कॉलसाठी कार्डावर टॅप करा.',
            mtNotice: 'हे यांत्रिक भाषांतर आहे आणि मूळ भाषिकाकडून तपासणे बाकी आहे. आणीबाणीत 108 वर कॉल करा.',
            searchPh: 'रुग्णालयाचे नाव किंवा परिसर शोधा...', allRegions: 'सर्व विभाग', allTypes: 'सर्व रुग्णालय प्रकार', optPublic: 'सरकारी', optPrivate: 'खासगी (एम्पॅनल्ड)', optSuper: 'सुपर स्पेशालिटी',
            loading: 'सर्व्हरवरून रुग्णालयांची थेट माहिती लोड होत आहे...',
            'ct_Public': 'सरकारी', 'ct_Private': 'खासगी', 'ct_Super Specialty': 'सुपर स्पेशालिटी', 'd_North Goa': 'उत्तर गोवा', 'd_South Goa': 'दक्षिण गोवा',
            liveBeds: 'खाटांची उपलब्धता', updated: 'अद्ययावत', bICU: 'आयसीयू', bOxygen: 'ऑक्सिजन', bGeneral: 'सामान्य',
            staffVerified: 'रुग्णालयाच्या कर्मचाऱ्यांनी अद्ययावत केले', staffUnverified: 'रुग्णालयाने अजून खात्री केलेली नाही. आकडे जुने असू शकतात.',
            mapRoute: 'गुगल मॅप्स मार्ग', callHospital: 'रुग्णालयाला कॉल करा', phoneNA: 'रुग्णालयाचा फोन क्रमांक पडताळलेला नाही. 104 हेल्पलाइन वापरा.',
            reportWait: 'सध्याची प्रतीक्षा कळवा', crowdLabel: 'गर्दी', cr_low: 'कमी', cr_moderate: 'मध्यम', cr_high: 'जास्त', cr_veryHigh: 'खूप गर्दी', cr_none: 'अजून थेट माहिती नाही',
            altTitle: 'जवळचे कमी गर्दीचे पर्याय', altKm: '{n} किमी', altGo: 'इकडे जा',
            emTitle: 'गोवा 108 आणीबाणी रुग्णवाहिका', em247: '24x7 सेवा', emDesc: 'संपूर्ण गोव्यात मोफत आणीबाणी रुग्णवाहिका. आधी कॉल करा, मग खालील पायऱ्या पाळा.',
            call108: '108 रुग्णवाहिकेला कॉल करा', call104: '104 आरोग्य हेल्पलाइन', emOffline: '108 आणि 104 बटणे इंटरनेटशिवाय चालतात.', emLast: 'शेवटची माहिती असलेली रुग्णालये (या फोनमध्ये जतन केलेली)', emLastNone: 'अजून रुग्णालयांची यादी जतन केलेली नाही. इंटरनेट असताना अॅप एकदा उघडा.',
            trTitle: 'जलद लक्षण तपासणी', trIntro: 'मुख्य त्रासावर टॅप करा. तुम्हाला लाल / पिवळा / हिरवा प्राधान्य आणि आत्ता योग्य खाट रिकामी असलेले सर्वात जवळचे रुग्णालय मिळेल.',
            trDisclaimer: 'फक्त निर्णयासाठी मदत. हे निदान नाही आणि डॉक्टरांची जागा घेत नाही. आणीबाणी वाटल्यास 108 वर कॉल करा.',
            trWhere: 'किंवा स्वतःच्या शब्दांत सांगा', trWherePh: 'उदा. छातीत दुखणे, 3 दिवस ताप', trSpeak: 'बोला', trGo: 'तपासा', trNoMatch: 'समजले नाही. वरीलपैकी एका बटणावर टॅप करा.',
            s_chest_pain: 'छातीत तीव्र वेदना', s_trauma: 'फ्रॅक्चर / दुखापत', s_maternity: 'प्रसूती / वेणा', s_fever: 'तीव्र ताप / डेंग्यू', s_stroke: 'बधिरता / पक्षाघात', s_breath: 'श्वास घेण्यास त्रास', s_minor: 'खोकला / सर्दी / सौम्य',
            lvl_red: 'लाल: आणीबाणी', lvl_amber: 'पिवळा: आजच डॉक्टरांना दाखवा', lvl_green: 'हिरवा: OPD भेट पुरेशी',
            a_chest_pain: 'हृदयाची आणीबाणी असू शकते. आत्ताच 108 वर कॉल करा. स्थिर राहा, सरळ बसा, घट्ट कपडे सैल करा. स्वतः गाडी चालवू नका.',
            a_stroke: 'पक्षाघात असू शकतो (चेहरा वाकडा होणे, हात कमजोर होणे, बोलण्यात अडचण). सुरू झाल्याची वेळ नोंदवा आणि आत्ताच 108 वर कॉल करा. खायला किंवा प्यायला देऊ नका.',
            a_breath: 'तीव्र श्वासाचा त्रास. आत्ताच 108 वर कॉल करा. सरळ बसा, कपडे सैल करा, शांत राहा. डॉक्टरांनी दिलेला इनहेलर किंवा ऑक्सिजन असल्यास वापरा.',
            a_maternity: 'प्रसूती किंवा गर्भावस्थेची आणीबाणी. ताबडतोब प्रसूती कक्ष असलेल्या रुग्णालयात जा. रक्तस्राव, पाणी फुटून वेदना किंवा बाळ येत असल्यास 108 वर कॉल करा. गर्भावस्थेची कागदपत्रे सोबत घ्या.',
            a_trauma: 'दुखापत किंवा फ्रॅक्चरचा संशय. जखमी अवयव किंवा मान हलवू नका. रक्त येत असलेल्या जागी घट्ट दाबा. जास्त रक्तस्राव, डोक्याला मार किंवा रस्ता अपघात असल्यास 108 वर कॉल करा.',
            a_fever: 'तीव्र तापासाठी आजच डॉक्टरांना दाखवा. तीव्र डोकेदुखी, पुरळ, हिरड्यांतून रक्त, उलट्या, पोटदुखी किंवा सुस्ती (डेंग्यूची संभाव्य धोक्याची लक्षणे) असल्यास लवकर जा. भरपूर द्रव प्या.',
            a_minor: 'सौम्य लक्षणे सहसा OPD भेटीपर्यंत थांबू शकतात. कमी गर्दीचे सरकारी केंद्र खाली दाखवले आहे. त्रास वाढल्यास इतर बटणे वापरा.',
            trNearest: 'आत्ता रिकामी {bed} खाट असलेली सर्वात जवळची सुविधा', bed_icu: 'आयसीयू', bed_oxygen: 'ऑक्सिजन', bed_general: 'सामान्य',
            trKm: '{n} किमी अंतरावर', trNoBeds: 'यादीतील कोणत्याही सुविधेत ही खाट आत्ता रिकामी नाही. 108 वर कॉल करा किंवा जवळच्या आणीबाणी विभागात जा.', trNoLoc: 'लोकेशन बंद आहे, म्हणून यादी अंतरानुसार लावलेली नाही.',
            trRerouted: 'GMC बांबोळी ऐवजी रिकामी खाट असलेल्या सर्वात जवळच्या रुग्णालयात पाठवले.', trFree: '{n} रिकाम्या', trDirections: 'मार्ग', trCall: 'कॉल', trBedsStaff: 'खाटांची माहिती रुग्णालयाच्या कर्मचाऱ्यांनी खात्री केलेली', trBedsOld: 'खाटांची माहिती कर्मचाऱ्यांनी अजून खात्री केलेली नाही',
            trLoading: 'रिकामी खाट असलेले सर्वात जवळचे रुग्णालय शोधत आहे...', trOffline: 'कनेक्शन नाही. आत्ताच 108 वर कॉल करा. वरील सल्ला इंटरनेटशिवाय चालतो.', trUseLoc: 'माझे लोकेशन वापरा'
        }
    };

    const KEY = 'gcLang';
    let lang = 'en';
    try { lang = localStorage.getItem(KEY) || 'en'; } catch (e) { /* private mode */ }
    if (!I18N[lang]) lang = 'en';

    // t('trKm', { n: 4.2 })  ->  translated string; falls back to English, then to the key itself.
    function t(key, vars) {
        let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
        if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
        return s;
    }

    // Static HTML is translated through attributes: data-i18n (text), data-i18n-ph (placeholder), data-i18n-aria (aria-label), data-i18n-title (title).
    function applyI18n() {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
        document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
        document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
        document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
        document.documentElement.lang = lang === 'gom' ? 'kok' : lang;
        const note = document.getElementById('mtNotice');
        if (note) { note.textContent = t('mtNotice'); note.classList.toggle('hidden', lang === 'en'); }
        const sel = document.getElementById('langSelect');
        if (sel) sel.value = lang;
    }

    function changeLanguage(next) {
        lang = I18N[next] ? next : 'en';
        try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
        applyI18n();
        document.dispatchEvent(new CustomEvent('gc:lang', { detail: { lang } }));   // modules re-render their dynamic parts
    }

    window.I18N = I18N;
    window.t = t;
    window.getLang = () => lang;
    window.applyI18n = applyI18n;
    window.changeLanguage = changeLanguage;
    document.addEventListener('DOMContentLoaded', applyI18n);
})();
