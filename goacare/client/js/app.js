// USER PROFILE & LOCAL STORAGE STATE
        let currentUserProfile = JSON.parse(localStorage.getItem('goaCareUserProfile')) || {
            name: "Eshaan Fernandes",
            phone: "+91 98221 44832",
            emergencyContact: "+91 98221 00108",
            bloodGroup: "O+ Positive",
            ddssyCard: "GOA-8842-2026",
            address: "Panaji, Tiswadi, Goa",
            allergies: "Penicillin",
            conditions: "None"
        };

        // MEDICAL HISTORY RECORDS LOCAL STATE
        let medicalRecords = JSON.parse(localStorage.getItem('goaCareMedicalRecords')) || [
            {
                id: 1,
                date: "2026-08-14",
                facility: "GMC Bambolim / Dr. Amol Tilve",
                diagnosis: "Hypertension & Routine Cardiac Check",
                prescription: "Amlodipine 5mg OD, Reduced sodium diet, ECG normal.",
                followup: "2026-11-14"
            },
            {
                id: 2,
                date: "2026-03-10",
                facility: "North Goa District Hospital",
                diagnosis: "Acute Bronchial Infection",
                prescription: "Azithromycin 500mg, Steam inhalation, Hydration.",
                followup: "Completed"
            }
        ];

        let authMode = 'login'; // 'login' or 'signup'

        // Initialization Logic
        window.onload = function() {
            loadProfileToUI();
            renderMedicalRecords();
        };

        function switchAuthMode(mode) {
            authMode = mode;
            const title = document.getElementById('authModalTitle');
            const sub = document.getElementById('authModalSub');
            const submitBtn = document.getElementById('authSubmitBtn');
            const signupField = document.getElementById('signupNameField');
            const tabLogin = document.getElementById('authTabLogin');
            const tabSignup = document.getElementById('authTabSignup');

            if (mode === 'signup') {
                title.innerText = "Create GoaCare Account";
                sub.innerText = "Register your profile for instant hospital admissions & DDSSY tracking.";
                submitBtn.innerText = "Register & Continue";
                signupField.classList.remove('hidden');
                tabSignup.className = "flex-1 py-2 text-xs font-bold border-b-2 border-teal-600 text-teal-700";
                tabLogin.className = "flex-1 py-2 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600";
            } else {
                title.innerText = "Welcome to GoaCare";
                sub.innerText = "Access Goa's integrated health services, bed tracking, and DDSSY benefits.";
                submitBtn.innerText = "Sign In to Portal";
                signupField.classList.add('hidden');
                tabLogin.className = "flex-1 py-2 text-xs font-bold border-b-2 border-teal-600 text-teal-700";
                tabSignup.className = "flex-1 py-2 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600";
            }
        }

        // NAVIGATION SWITCHER
        function switchTab(tabId) {
            const tabs = ['facilities', 'doctors', 'records', 'profile', 'ddssy', 'emergency'];
            tabs.forEach(t => {
                document.getElementById(`section-${t}`)?.classList.add('hidden');
                document.getElementById(`tab-${t}`)?.classList.remove('tab-active');
            });

            document.getElementById(`section-${tabId}`)?.classList.remove('hidden');
            document.getElementById(`tab-${tabId}`)?.classList.add('tab-active');
        }

        function toggleMobileMenu() {
            document.getElementById('mobile-menu').classList.toggle('hidden');
        }

        function renderHospitals(list) {
            const grid = document.getElementById('hospitalGrid');
            grid.innerHTML = '';

            list.forEach(fac => {
                const mapRouteUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fac.name + ', ' + fac.address)}`;

                grid.innerHTML += `
                    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4">
                        <div class="space-y-3">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md ${fac.careType === 'Public' ? 'bg-teal-100 text-teal-800' : 'bg-purple-100 text-purple-800'}">${fac.careType}</span>
                                <span class="text-[11px] font-bold text-slate-500"><i class="fa-solid fa-map-pin text-rose-500 mr-1"></i>${fac.district}</span>
                            </div>
                            <h3 class="text-base font-bold text-slate-900 leading-snug">${fac.name}</h3>
                            <p class="text-xs text-slate-500"><i class="fa-solid fa-location-dot text-slate-400 mr-1"></i>${fac.address}</p>

                            <!-- Bed Capacity Matrix -->
                            <div class="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                <div class="flex items-center justify-between mb-1.5">
                                    <span class="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Live Bed Capacity:</span>
                                    ${fac.updatedAt ? `<span class="text-[9px] text-slate-400">Updated ${new Date(fac.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}
                                </div>
                                <div class="grid grid-cols-3 gap-2 text-center text-xs">
                                    <div class="bg-white p-1.5 rounded-lg border border-slate-200">
                                        <span class="block text-slate-400 text-[10px]">ICU</span>
                                        <span class="font-extrabold ${fac.icuBeds > 0 ? 'text-teal-600' : 'text-rose-500'}">${fac.icuBeds}</span>
                                    </div>
                                    <div class="bg-white p-1.5 rounded-lg border border-slate-200">
                                        <span class="block text-slate-400 text-[10px]">Oxygen</span>
                                        <span class="font-extrabold text-teal-600">${fac.oxygenBeds}</span>
                                    </div>
                                    <div class="bg-white p-1.5 rounded-lg border border-slate-200">
                                        <span class="block text-slate-400 text-[10px]">General</span>
                                        <span class="font-extrabold text-teal-600">${fac.generalBeds}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="flex flex-wrap gap-1 pt-1">
                                ${fac.specialties.map(s => `<span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium">${s}</span>`).join('')}
                            </div>
                        </div>

                        <!-- Google Maps Direct Route Button -->
                        <div class="space-y-2 pt-2 border-t border-slate-100">
                            <a href="${mapRouteUrl}" target="_blank" class="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition shadow-xs">
                                <i class="fa-solid fa-location-arrow text-emerald-300"></i> Google Maps Route
                            </a>
                            <a href="tel:${fac.phone}" class="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition">
                                <i class="fa-solid fa-phone text-teal-600"></i> Emergency Helpline
                            </a>
                        </div>
                    </div>
                `;
            });
        }

        function filterHospitals() {
            const query = document.getElementById('hospitalSearch').value.toLowerCase().trim();
            const district = document.getElementById('districtFilter').value;
            const careType = document.getElementById('careTypeFilter').value;

            const filtered = facilitiesData.filter(fac => {
                const matchesSearch = fac.name.toLowerCase().includes(query) ||
                                      fac.address.toLowerCase().includes(query);
                const matchesDistrict = district === 'all' || fac.district === district;
                const matchesCareType = careType === 'all' || fac.careType === careType;
                return matchesSearch && matchesDistrict && matchesCareType;
            });

            renderHospitals(filtered);
        }

        function renderDoctors(list) {
            const doctorsContainer = document.getElementById('doctorsList');
            if (!list || list.length === 0) {
                doctorsContainer.innerHTML = `<div class="col-span-full py-8 text-center text-slate-500 text-xs">No doctor found matching your search. Try searching for "Cardiology", "Orthopedics", or doctor names.</div>`;
                return;
            }

            doctorsContainer.innerHTML = list.map(d => {
                let statusBg = 'bg-emerald-100 text-emerald-800';
                if (d.status === 'In Surgery') statusBg = 'bg-amber-100 text-amber-800';
                if (d.status === 'On Call') statusBg = 'bg-blue-100 text-blue-800';

                return `
                    <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-white transition flex flex-col justify-between shadow-xs space-y-3">
                        <div class="space-y-1.5">
                            <div class="flex items-start justify-between gap-2">
                                <h4 class="font-bold text-slate-900 text-sm">${d.name}</h4>
                                <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${statusBg}">${d.status}</span>
                            </div>
                            <p class="text-xs text-teal-700 font-extrabold"><i class="fa-solid fa-user-doctor mr-1"></i>${d.spec}</p>
                            <p class="text-xs text-slate-600"><i class="fa-solid fa-hospital text-slate-400 mr-1"></i>${d.hospital}</p>
                            <p class="text-[11px] text-slate-500"><i class="fa-solid fa-clock text-slate-400 mr-1"></i>OPD: ${d.timings}</p>
                            <p class="text-[11px] text-slate-500"><i class="fa-solid fa-door-open text-slate-400 mr-1"></i>${d.room}</p>
                        </div>
                        <div class="pt-2 border-t border-slate-200 flex justify-between items-center text-[11px]">
                            <span class="text-slate-500 font-medium">Fee:</span>
                            <span class="font-bold text-slate-800">${d.fee}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function filterDoctors() {
            const query = document.getElementById('doctorSearch').value.toLowerCase().trim();
            const specFilter = document.getElementById('doctorSpecFilter').value;

            const filtered = doctorsData.filter(d => {
                const matchesQuery = d.name.toLowerCase().includes(query) ||
                                     d.spec.toLowerCase().includes(query) ||
                                     d.hospital.toLowerCase().includes(query);
                const matchesSpec = specFilter === 'all' || d.spec === specFilter;
                return matchesQuery && matchesSpec;
            });

            renderDoctors(filtered);
        }

        function getInitials(name) {
            if (!name) return "GC";
            const parts = name.trim().split(" ");
            if (parts.length >= 2) {
                return (parts[0][0] + parts[1][0]).toUpperCase();
            }
            return parts[0].substring(0, 2).toUpperCase();
        }

        function loadProfileToUI() {
            document.getElementById('profName').value = currentUserProfile.name || "";
            document.getElementById('profPhone').value = currentUserProfile.phone || "";
            document.getElementById('profEmerg').value = currentUserProfile.emergencyContact || "";
            document.getElementById('profBlood').value = currentUserProfile.bloodGroup || "O+ Positive";
            document.getElementById('profDdssy').value = currentUserProfile.ddssyCard || "";
            document.getElementById('profAddress').value = currentUserProfile.address || "";
            document.getElementById('profAllergies').value = currentUserProfile.allergies || "";
            document.getElementById('profConditions').value = currentUserProfile.conditions || "";

            // Header & Report Sync
            const initials = getInitials(currentUserProfile.name);
            document.getElementById('headerAvatarInitials').innerText = initials;
            document.getElementById('headerProfileName').innerText = currentUserProfile.name.split(" ")[0] || "User";
            document.getElementById('reportAvatar').innerText = initials;
            document.getElementById('reportName').innerText = currentUserProfile.name || "Patient Profile";
            document.getElementById('reportPhone').innerText = currentUserProfile.phone || "N/A";
            document.getElementById('reportBlood').innerText = currentUserProfile.bloodGroup || "N/A";
            document.getElementById('reportDdssy').innerText = currentUserProfile.ddssyCard || "N/A";
            document.getElementById('profileCardAvatar').innerText = initials;
        }

        function saveUserProfile(e) {
            e.preventDefault();
            currentUserProfile.name = document.getElementById('profName').value;
            currentUserProfile.phone = document.getElementById('profPhone').value;
            currentUserProfile.emergencyContact = document.getElementById('profEmerg').value;
            currentUserProfile.bloodGroup = document.getElementById('profBlood').value;
            currentUserProfile.ddssyCard = document.getElementById('profDdssy').value;
            currentUserProfile.address = document.getElementById('profAddress').value;
            currentUserProfile.allergies = document.getElementById('profAllergies').value;
            currentUserProfile.conditions = document.getElementById('profConditions').value;

            saveProfileToStorage();
            loadProfileToUI();

            const status = document.getElementById('profileSaveStatus');
            status.classList.remove('hidden');
            setTimeout(() => status.classList.add('hidden'), 3000);
        }

        function saveProfileToStorage() {
            localStorage.setItem('goaCareUserProfile', JSON.stringify(currentUserProfile));
        }

        function renderMedicalRecords() {
            const tbody = document.getElementById('medicalRecordsTableBody');
            if (medicalRecords.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 text-xs">No past medical history records logged. Click 'Add History Record' to add your first entry.</td></tr>`;
                return;
            }

            tbody.innerHTML = medicalRecords.map(r => `
                <tr class="hover:bg-slate-50 transition">
                    <td class="p-3 font-semibold text-slate-800 whitespace-nowrap">${r.date}</td>
                    <td class="p-3 font-medium text-slate-800">${r.facility}</td>
                    <td class="p-3 font-bold text-teal-800">${r.diagnosis}</td>
                    <td class="p-3 text-slate-600 max-w-xs">${r.prescription}</td>
                    <td class="p-3 text-slate-500 whitespace-nowrap">${r.followup || 'N/A'}</td>
                    <td class="p-3 text-right no-print whitespace-nowrap">
                        <button onclick="deleteMedicalRecord(${r.id})" class="text-rose-500 hover:text-rose-700 font-bold px-2 py-1"><i class="fa-solid fa-trash-can"></i></button>
                    </td>
                </tr>
            `).join('');
        }

        function openAddRecordModal() {
            document.getElementById('addRecordModal').classList.remove('hidden');
        }

        function closeAddRecordModal() {
            document.getElementById('addRecordModal').classList.add('hidden');
        }

        function saveMedicalRecord(e) {
            e.preventDefault();
            const newRecord = {
                id: Date.now(),
                date: document.getElementById('recDate').value,
                followup: document.getElementById('recFollowup').value,
                facility: document.getElementById('recFacility').value,
                diagnosis: document.getElementById('recDiagnosis').value,
                prescription: document.getElementById('recPrescription').value
            };

            medicalRecords.unshift(newRecord);
            localStorage.setItem('goaCareMedicalRecords', JSON.stringify(medicalRecords));
            renderMedicalRecords();
            closeAddRecordModal();
            document.getElementById('recordForm').reset();
        }

        function deleteMedicalRecord(id) {
            medicalRecords = medicalRecords.filter(r => r.id !== id);
            localStorage.setItem('goaCareMedicalRecords', JSON.stringify(medicalRecords));
            renderMedicalRecords();
        }

        // DDSSY CALCULATOR
        function calculateDDSSY() {
            const familyCap = parseInt(document.getElementById('ddssyFamily').value);
            const hospType = document.getElementById('ddssyHospType').value;
            const procedureCost = parseInt(document.getElementById('ddssyProcedure').value);

            let covered = 0;
            let outOfPocket = 0;

            if (hospType === 'Govt') {
                covered = procedureCost;
                outOfPocket = 0;
            } else {
                covered = Math.min(familyCap, procedureCost);
                outOfPocket = Math.max(0, procedureCost - familyCap);
            }

            const resDiv = document.getElementById('ddssyResult');
            resDiv.classList.remove('hidden');
            resDiv.innerHTML = `
                <div class="font-bold text-sm text-teal-900 border-b border-teal-200 pb-1">Estimated DDSSY Coverage Summary:</div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 text-xs">
                    <div>Estimated Cost: <strong class="block text-sm font-bold text-slate-800">₹${procedureCost.toLocaleString('en-IN')}</strong></div>
                    <div>Covered by DDSSY: <strong class="block text-sm font-bold text-teal-700">₹${covered.toLocaleString('en-IN')}</strong></div>
                    <div>Out-of-Pocket Expense: <strong class="block text-sm font-bold ${outOfPocket > 0 ? 'text-rose-600' : 'text-emerald-700'}">₹${outOfPocket.toLocaleString('en-IN')}</strong></div>
                </div>
            `;
        }

        // SYMPTOM TRIAGE
        function assessTriage(type) {
            const box = document.getElementById('triageResult');
            box.classList.remove('hidden');

            if (type === 'chest_pain' || type === 'stroke' || type === 'breath') {
                box.className = "mt-4 p-4 rounded-xl bg-rose-100 border border-rose-300 text-xs text-rose-900 space-y-2";
                box.innerHTML = `
                    <div class="font-bold text-sm text-rose-800"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Priority 1 Emergency Detected</div>
                    <div>Urgent critical condition. Immediate evaluation required at <strong>GMC Bambolim ER Wards</strong> or nearest Trauma Center.</div>
                    <div class="flex gap-2 pt-2">
                        <a href="tel:108" class="px-3 py-2 bg-rose-600 text-white rounded-lg font-bold text-xs"><i class="fa-solid fa-phone mr-1"></i> Call 108 Ambulance</a>
                    </div>
                `;
            } else {
                box.className = "mt-4 p-4 rounded-xl bg-teal-100 border border-teal-300 text-xs text-teal-900 space-y-2";
                box.innerHTML = `
                    <div class="font-bold text-sm text-teal-800"><i class="fa-solid fa-circle-check mr-1"></i> OPD Consultation Advised</div>
                    <div>Please visit the outpatient consultation wing at your nearest North or South Goa District Hospital.</div>
                `;
            }
        }
