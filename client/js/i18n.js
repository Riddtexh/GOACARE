// MULTI-LANGUAGE TOGGLE
        const i18n = {
            en: { subtitle: "Goa Health & Emergency Portal", navFac: "Hospitals & Beds", navDoc: "Doctors Status", navRecords: "Medical History Report", navProfile: "User Profile", navDdssy: "DDSSY & Insurance", navSos: "Symptom Triage & SOS", titleHospitals: "Hospitals & Bed Availability in Goa" },
            gom: { subtitle: "गोंय भलायकी आनी आणीबाणी सेवा", navFac: "हॉस्पिटलां आनी खाटां", navDoc: "डॉक्टर स्थिती", navRecords: "वैद्यकीय इतिहास", navProfile: "वापरपी प्रोफाइल", navDdssy: "DDSSY आनी विमो", navSos: "लक्षणां आनी SOS", titleHospitals: "गोंयांतलीं हॉस्पिटलां आनी खाटांची स्थिती" },
            hi: { subtitle: "गोवा स्वास्थ्य और आपातकालीन पोर्टल", navFac: "अस्पताल और बेड", navDoc: "डॉक्टरों की स्थिति", navRecords: "मेडिकल रिपोर्ट", navProfile: "उपयोगकर्ता प्रोफ़ाइल", navDdssy: "DDSSY और बीमा", navSos: "लक्षण जांच व एसओएस", titleHospitals: "गोवा में अस्पताल और बेड की स्थिति" },
            mr: { subtitle: "गोवा आरोग्य आणि आणीबाणी सेवा", navFac: "रुग्णालये व खाटा", navDoc: "डॉक्टर स्थिती", navRecords: "वैद्यकीय अहवाल", navProfile: "वापरकर्ता प्रोफाइल", navDdssy: "DDSSY अंदाज", navSos: "आणीबाणी एसओएस", titleHospitals: "गोव्यातील रुग्णालये आणि वैद्यकीय केंद्रे" }
        };

        function changeLanguage(lang) {
            const data = i18n[lang] || i18n.en;
            document.getElementById('lbl-subtitle').innerText = data.subtitle;
            document.getElementById('nav-fac').innerText = data.navFac;
            document.getElementById('nav-doc').innerText = data.navDoc;
            document.getElementById('nav-records').innerText = data.navRecords;
            document.getElementById('nav-profile').innerText = data.navProfile;
            document.getElementById('nav-ddssy').innerText = data.navDdssy;
            document.getElementById('nav-sos').innerText = data.navSos;
            document.getElementById('title-hospitals').innerText = data.titleHospitals;
        }
