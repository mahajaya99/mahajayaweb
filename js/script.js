// ================= AUTH / LOGIN =================
// Sistem login sederhana dengan 2 akun tetap: "petugas" (hanya bisa akses tab
// Payment) dan "admin" (akses penuh semua fitur, seperti sebelumnya).
// CATATAN PENTING: ini adalah pembatasan di sisi TAMPILAN (UI) saja, cocok untuk
// tim internal kecil yang saling percaya. Ini BUKAN keamanan tingkat sistem —
// siapa pun yang tahu URL web app & mahir teknis tetap bisa memanggil fungsi
// server lain lewat console browser meski login sebagai petugas, karena Google
// Apps Script tidak membatasi google.script.run per-role. Kalau butuh proteksi
// yang lebih kuat (mis. data sensitif harus benar-benar tidak bisa diakses
// petugas), pembatasan itu perlu ditambahkan juga di Code.gs per fungsi.
const AUTH_ACCOUNTS = {
  'petugas': { password: 'petugas', role: 'petugas', label: 'Petugas', name: 'Petugas MahaJayaNet' },
  'admin':   { password: 'admin123', role: 'admin',   label: 'Admin',   name: 'Admin MahaJayaNet' }
};
const AUTH_STORAGE_KEY = 'mjnet_session';

function getSession(){
  try{ return JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY) || 'null'); }
  catch(e){ return null; }
}
function setSession(session){
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}
function clearSession(){
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

function handleLogin(e){
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const account = AUTH_ACCOUNTS[username];
  if(!account || account.password !== password){
    errEl.textContent = 'Username atau password salah.';
    errEl.classList.add('show');
    return;
  }
  errEl.classList.remove('show');
  setSession({ username, role: account.role, label: account.label, name: account.name });
  document.getElementById('formLogin').reset();
  enterApp();
}

function handleLogout(){
  clearSession();
  document.getElementById('appRoot').classList.remove('show');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.remove('show');
}

// Terapkan pembatasan tampilan sesuai role: akun "petugas" hanya melihat tab
// Payment (item nav lain disembunyikan total dari sidebar), akun "admin" melihat
// semuanya seperti biasa.
function applyRoleUI(session){
  document.getElementById('sidebarWhoName').textContent = session.name;
  document.getElementById('sidebarWhoRole').textContent = session.label;
  document.getElementById('sidebarAvatar').textContent = session.role === 'admin' ? 'AD' : 'PT';

  const isPetugas = session.role === 'petugas';
  document.querySelectorAll('#navList .nav-item').forEach(item=>{
    item.style.display = (isPetugas && item.dataset.view !== 'payment') ? 'none' : '';
  });

  if(isPetugas){
    // Kunci tampilan langsung ke tab Payment dan cegah pindah ke view lain.
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.querySelector('#navList .nav-item[data-view="payment"]').classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-payment').classList.add('active');
    document.getElementById('pageTitle').textContent = titles.payment[0];
    document.getElementById('pageSub').textContent = titles.payment[1];
    currentView = 'payment';
  }
}

function enterApp(){
  const session = getSession();
  if(!session){ return; }
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').classList.add('show');
  applyRoleUI(session);
  loadView(currentView);
}

// ================= UTIL =================
// URL Web App Apps Script (Deploy > New deployment > Web app), diakhiri "/exec".
// Frontend ini kini statis (HTML/CSS/JS terpisah) dan dihosting di luar Apps
// Script, jadi google.script.run tidak lagi tersedia — semua panggilan ke
// backend (Code.gs) dilakukan lewat fetch() ke URL Web App ini. Ganti
// GAS_API_URL di bawah dengan URL deployment Apps Script punya kamu.
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyyj_f2rpwi16hud_bTBzf-4n81u9sgNX-6L28RRPt3tz6M9uyfxAq5QoS0sp3ikE-9/exec';

function gs(fn, ...args){
  if (!GAS_API_URL || GAS_API_URL.indexOf('PASTE_URL_WEB_APP') !== -1){
    return Promise.reject(new Error('GAS_API_URL belum diisi di script.js. Isi dengan URL Web App Apps Script (Deploy > New deployment > Web app), diakhiri "/exec".'));
  }
  return fetch(GAS_API_URL, {
    method: 'POST',
    // Content-Type text/plain dipakai supaya browser mengirim "simple request"
    // (tanpa preflight OPTIONS), karena Apps Script Web App tidak merespons
    // preflight CORS dengan benar.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn, args })
  })
    .then(res => res.json())
    .then(json => {
      if (!json || json.success !== true){
        throw new Error((json && json.error) || 'Terjadi kesalahan pada server.');
      }
      return json.data;
    });
}
function rupiah(n){ n = Number(n)||0; return 'Rp ' + n.toLocaleString('id-ID'); }

// ================= CETAK STRUK PEMBAYARAN (58mm thermal) =================
// Dibuka di tab/window baru (BUKAN iframe) berukuran kertas 58mm. Web App Apps
// Script memuat index.html di dalam iframe cross-origin, dan browser memblokir
// total Web Bluetooth API dari dalam iframe seperti itu — makanya proses
// Bluetooth harus dijalankan di jendela popup sendiri ini, bukan di halaman
// utama.
//
// Di jendela struk tersedia 2 tombol:
//   1) "Cetak Bluetooth (BLE)" — kirim langsung ke printer lewat Web Bluetooth
//      API, TANPA install app apa pun. Hanya jalan kalau printer mendukung
//      mode Bluetooth Low Energy (BLE). Kebanyakan printer mini 58mm murah
//      (termasuk seri RPP02N seperti IWARE MP-58SB) memakai Bluetooth Classic
//      (SPP), yang TIDAK bisa diakses browser manapun — ini keterbatasan
//      platform, bukan bug kode.
//   2) "Cetak / Print" — memicu dialog print bawaan Android/Chrome seperti
//      biasa. Kalau app ringan RawBT sudah terpasang, printer Bluetooth
//      Classic seperti MP-58SB otomatis muncul sebagai pilihan printer di
//      situ, dan ke depannya cetak jadi 1x tap tanpa isi apa pun lagi.
function printReceipt(p){
  if(!p){ toast('Simpan pembayaran terlebih dahulu sebelum mencetak struk.', true); return; }
  const w = window.open('', '_blank', 'width=380,height=760');
  if(!w){ toast('Popup diblokir browser. Izinkan popup untuk mencetak struk.', true); return; }

  const diskonPersen = Number(p.diskonPersen)||0;
  const diskonNominal = Number(p.diskonNominal)||0;
  const tagihanAsli = Number(p.jumlahAsli != null ? p.jumlahAsli : p.jumlah) || 0;
  const total = Number(p.jumlah)||0; // sudah final (setelah diskon), langsung dari backend
  const tanggalBayar = p.tglBayarLabel || p.tglBayar || '-';
  const periode = p.periodeLabel || p.periode || '-';

  // Data yang di-encode ke dalam QR code
  const qrText = 'ID PELANGGAN: ' + (p.idPelanggan||'-') +
    '\nNAMA PELANGGAN: ' + (p.nama||'-') +
    '\nTANGGAL PEMBAYARAN: ' + tanggalBayar +
    '\nPERIODE: ' + periode;
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=0&data=' + encodeURIComponent(qrText);

  // Data mentah dikirim ke jendela popup untuk membangun perintah ESC/POS
  // (dipakai oleh jalur cetak Bluetooth BLE di dalam popup).
  const receiptData = {
    namaUsaha: 'MahaJayaNet',
    tagline: 'Mengalirkan Koneksi, Menyatukan Negeri',
    alamat: 'Blok i6/7, Perum GG2, Kembiritan, Genteng',
    wa: 'WA : 0821-3158-3877',
    tglBayar: tanggalBayar,
    idPelanggan: p.idPelanggan || '-',
    nama: p.nama || '-',
    paket: p.paket || '-',
    periode: periode,
    tagihan: rupiah(tagihanAsli),
    metode: p.metode || '-',
    diskon: diskonNominal > 0 ? (rupiah(diskonNominal) + ' (' + diskonPersen + '%)') : '',
    total: rupiah(total),
    qrText: qrText
  };

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Struk Pembayaran ${p.idPelanggan}</title>
<style>
  @page{ size: 58mm auto; margin: 2mm; }
  *{ box-sizing:border-box; }
  html,body{ background:#eee; margin:0; width:100%; }
  body{ padding:16px 12px 24px; font-family:'Courier New',monospace; font-size:16px; line-height:1.55; color:#000; font-weight:700; }
  .sheet{ background:#fff; width:100%; max-width:420px; margin:0 auto; padding:16px; border-radius:10px; box-shadow:0 1px 6px rgba(0,0,0,.2); }
  .center{ text-align:center; }
  .italic{ font-style:italic; }
  .bold{ font-weight:800; }
  .line{ border-top:2px dashed #000; margin:6px 0; }
  table{ width:100%; border-collapse:collapse; font-size:16px; font-weight:700; }
  td{ padding:2.5px 0; vertical-align:top; }
  .right{ text-align:right; }
  .title{ font-size:21px; font-weight:800; letter-spacing:.3px; }
  .total-row td{ border-top:2px solid #000; padding-top:6px; font-size:18px; font-weight:800; }
  .qr-wrap{ text-align:center; margin-top:12px; }
  .qr-wrap img{ width:160px; height:160px; max-width:60%; }
  .qr-caption{ font-size:12px; margin-top:4px; }

  .no-print{ max-width:420px; margin:14px auto 0; font-family:'Segoe UI',Arial,sans-serif; }
  @media print{
    .no-print{ display:none !important; }
    html,body{ background:#fff; }
    body{ padding:0; font-size:11px; line-height:1.45; }
    .sheet{ width:54mm; max-width:54mm; margin:0; padding:6px; border-radius:0; box-shadow:none; }
    table{ font-size:11px; }
    td{ padding:1.5px 0; }
    .line{ border-top-width:1px; margin:5px 0; }
    .title{ font-size:15px; }
    .total-row td{ border-top-width:1px; padding-top:4px; font-size:13px; }
    .qr-wrap img{ width:28mm; height:28mm; max-width:none; }
    .qr-caption{ font-size:8.5px; }
  }
  .bt-btn{ display:block; width:100%; text-align:center; padding:13px 10px; border-radius:10px; border:none; font-weight:700; font-size:15px; cursor:pointer; margin-top:8px; }
  .bt-btn.primary{ background:#4c3fc7; color:#fff; }
  .bt-btn.pdf{ background:#e0342c; color:#fff; }
  .bt-btn.ghost{ background:#e6e6e6; color:#222; }
  .bt-status{ margin-top:8px; font-size:13px; color:#555; min-height:16px; line-height:1.4; }
  .bt-status.err{ color:#c0392b; }
  .bt-status.ok{ color:#1ea672; }
  .bt-hint{ margin-top:10px; font-size:12px; color:#888; line-height:1.5; }
  .bt-hint b{ color:#555; }
</style></head>
<body>
  <div class="sheet">
    <div class="center title">${receiptData.namaUsaha}</div>
    <div class="center italic">${receiptData.tagline}</div>
    <div class="center italic">${receiptData.alamat}</div>
    <div class="center italic">${receiptData.wa}</div>
    <br>
    <table><tr><td class="right">${receiptData.tglBayar}</td></tr></table>
    <div class="line"></div>
    <table>
      <tr><td>ID Pelanggan</td><td class="right bold">${receiptData.idPelanggan}</td></tr>
      <tr><td>Nama</td><td class="right">${receiptData.nama}</td></tr>
      <tr><td>Paket</td><td class="right">${receiptData.paket}</td></tr>
      <tr><td>Periode Bulan</td><td class="right">${receiptData.periode}</td></tr>
      <tr><td>Tagihan</td><td class="right">${receiptData.tagihan}</td></tr>
      <tr><td>Metode</td><td class="right">${receiptData.metode}</td></tr>
      <tr><td>Diskon</td><td class="right">${receiptData.diskon}</td></tr>
      <tr class="total-row"><td class="bold">Total</td><td class="right bold">${receiptData.total}</td></tr>
    </table>
    <br>
    <div class="center italic bold">Perhatian!</div>
    <div class="center italic">Batas Pembayaran Terakhir Tgl 20 Setiap Bulan</div>
    <div class="center italic">Internet Akan Mati Otomatis Dari Sistem</div>
    <div class="center italic">Jika Tanpa Konfirmasi</div>
    <br>
    <div class="center">Terima Kasih Atas Kepercayaan Anda</div>
    <div class="center">Menggunakan Layanan Kami</div>
    <div class="qr-wrap">
      <img id="qrImg" src="${qrUrl}" alt="QR Struk">
      <div class="qr-caption">Scan untuk verifikasi pembayaran</div>
    </div>
  </div>

  <div class="no-print">
    <button class="bt-btn primary" id="btnBtPrint" onclick="btPrintNow()">📶 Cetak Bluetooth (BLE)</button>
    <button class="bt-btn pdf" type="button" onclick="window.print()">📄 Simpan PDF</button>
    <button class="bt-btn ghost" type="button" onclick="window.print()">🖨️ Cetak / Print (RawBT)</button>
    <div class="bt-status" id="btStatus"></div>
    <div class="bt-hint">
      "Cetak Bluetooth (BLE)" hanya berfungsi untuk printer bermode Bluetooth Low Energy.
      Kebanyakan printer mini 58mm (termasuk seri RPP02N seperti IWARE MP-58SB) memakai
      Bluetooth Classic — untuk itu pakai tombol "Cetak / Print" lalu pilih app
      <b>RawBT</b> sebagai printer (cukup sekali install, selanjutnya cetak 1x tap tanpa isi apa pun lagi).
    </div>
  </div>

<script>
  const RECEIPT = ${JSON.stringify(receiptData)};

  // ---------------- ESC/POS byte builder ----------------
  function buildEscPos(d){
    const bytes = [];
    const enc = new TextEncoder();
    function push(){ for(const b of arguments) bytes.push(b); }
    function text(str){ enc.encode(str).forEach(b=>bytes.push(b)); }
    function line(str){ text(str); push(0x0A); }
    function center(on){ push(0x1B,0x61, on?0x01:0x00); }
    function bold(on){ push(0x1B,0x45, on?0x01:0x00); }
    function big(on){ push(0x1D,0x21, on?0x11:0x00); }
    function feed(n){ for(let i=0;i<n;i++) push(0x0A); }
    function row(left,right,width){
      width = width||32;
      const space = Math.max(1, width - left.length - right.length);
      line(left + ' '.repeat(space) + right);
    }
    function dash(width){ line('-'.repeat(width||32)); }
    // Printer memotong paksa di batas kolom (mis. 32 karakter) tanpa peduli
    // spasi kata — makanya kalimat panjang perlu dipecah manual per kata di
    // sisi kita dulu, supaya tidak ada kata yang terpotong di tengah saat
    // printer menerima baris yang lebih panjang dari lebar kertasnya.
    function wordWrap(str, width){
      const words = str.split(' ');
      const lines = [];
      let cur = '';
      for(let w of words){
        while(w.length > width){ // kata tunggal yang lebih panjang dari lebar kertas
          if(cur.length){ lines.push(cur); cur=''; }
          lines.push(w.slice(0,width));
          w = w.slice(width);
        }
        if(cur.length === 0) cur = w;
        else if(cur.length + 1 + w.length <= width) cur += ' ' + w;
        else { lines.push(cur); cur = w; }
      }
      if(cur.length) lines.push(cur);
      return lines;
    }
    function wline(str, width){ wordWrap(str, width||32).forEach(l=>line(l)); }

    push(0x1B,0x40); // initialize
    bold(true); // teks tebal dipakai di seluruh struk supaya lebih jelas saat tercetak
    center(true); big(true);
    wline(d.namaUsaha, 16); // mode double-width aktif -> lebar efektif cuma 16 kolom
    big(false);
    wline(d.tagline, 32);
    wline(d.alamat, 32);
    wline(d.wa, 32);
    feed(1);
    center(false);
    row('', d.tglBayar);
    dash(32);
    row('ID Pelanggan', d.idPelanggan);
    row('Nama', d.nama.length>20 ? d.nama.substring(0,20) : d.nama);
    row('Paket', d.paket.length>20 ? d.paket.substring(0,20) : d.paket);
    row('Periode', d.periode);
    row('Tagihan', d.tagihan);
    row('Metode', d.metode);
    if(d.diskon) row('Diskon', d.diskon);
    dash(32);
    big(true);
    row('Total', d.total);
    big(false);
    feed(1);
    center(true);
    wline('Perhatian!', 32);
    wline('Batas Pembayaran Tgl 20 Setiap Bulan', 32);
    wline('Internet Mati Otomatis Tanpa Konfirmasi', 32);
    feed(1);
    wline('Terima Kasih Atas Kepercayaan Anda', 32);
    wline('Menggunakan Layanan Kami', 32);
    feed(1);

    // QR dicetak native oleh printer (GS ( k) — tidak butuh internet sama sekali.
    function storeGsk(cn,fn,params){
      const body = [cn,fn].concat(params);
      const len = body.length;
      push(0x1D,0x28,0x6B, len & 0xFF, (len>>8) & 0xFF);
      push.apply(null, body);
    }
    const qrBytes = Array.from(enc.encode(d.qrText));
    storeGsk(0x31,0x41,[50,0]);   // model 2
    storeGsk(0x31,0x43,[5]);      // ukuran modul
    storeGsk(0x31,0x45,[49]);     // error correction level M
    (function(){
      const body = [0x31,0x50,0x30].concat(qrBytes);
      const len = body.length;
      push(0x1D,0x28,0x6B, len & 0xFF, (len>>8) & 0xFF);
      push.apply(null, body);
    })();
    storeGsk(0x31,0x51,[0x30]);   // cetak QR

    feed(4);
    return new Uint8Array(bytes);
  }

  // ---------------- Web Bluetooth (khusus printer BLE) ----------------
  const BT_SERVICES = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
  ];

  function setBtStatus(msg, cls){
    const el = document.getElementById('btStatus');
    el.textContent = msg;
    el.className = 'bt-status' + (cls ? ' '+cls : '');
  }

  async function btFindWritableChar(server){
    for(const svc of BT_SERVICES){
      try{
        const service = await server.getPrimaryService(svc);
        const chars = await service.getCharacteristics();
        const c = chars.find(function(c){ return c.properties.writeWithoutResponse || c.properties.write; });
        if(c) return c;
      }catch(e){ /* servis ini tidak ada di device, lanjut coba yang lain */ }
    }
    try{
      const services = await server.getPrimaryServices();
      for(const service of services){
        const chars = await service.getCharacteristics();
        const c = chars.find(function(c){ return c.properties.writeWithoutResponse || c.properties.write; });
        if(c) return c;
      }
    }catch(e){}
    return null;
  }

  async function btWriteAll(char, bytes){
    const CHUNK = 180;
    for(let i=0;i<bytes.length;i+=CHUNK){
      const slice = bytes.slice(i, i+CHUNK);
      if(char.properties.writeWithoutResponse) await char.writeValueWithoutResponse(slice);
      else await char.writeValue(slice);
      await new Promise(function(r){ setTimeout(r,25); });
    }
  }

  async function btPrintNow(){
    if(!navigator.bluetooth){
      setBtStatus('Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome di Android, atau pakai tombol "Cetak / Print".', 'err');
      return;
    }
    try{
      setBtStatus('Membuka pilihan perangkat Bluetooth...');
      let device = null;
      try{
        if(navigator.bluetooth.getDevices){
          const known = await navigator.bluetooth.getDevices();
          if(known && known.length) device = known[0];
        }
      }catch(e){}
      if(!device){
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: BT_SERVICES
        });
      }
      setBtStatus('Menghubungkan ke ' + (device.name||'printer') + '...');
      const server = await device.gatt.connect();
      const char = await btFindWritableChar(server);
      if(!char){
        setBtStatus('Printer ini tidak bisa diakses lewat BLE dari browser (kemungkinan pakai Bluetooth Classic/SPP). Gunakan tombol "Cetak / Print" + app RawBT.', 'err');
        return;
      }
      setBtStatus('Mengirim struk ke printer...');
      const bytes = buildEscPos(RECEIPT);
      await btWriteAll(char, bytes);
      setBtStatus('\u2713 Struk terkirim ke printer.', 'ok');
    }catch(err){
      setBtStatus('Gagal: ' + (err && err.message ? err.message : err) + '. Coba tombol "Cetak / Print" sebagai alternatif.', 'err');
    }
  }
<\/script>
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function toast(msg, isErr){
  const el = document.createElement('div');
  el.className = 'toast-item' + (isErr?' err':'');
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}
let dataPopupHideTimer = null;
const ICON_LOADING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-9-9"/></svg>';
const ICON_SUCCESS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
// Tampilkan popup "Data Sedang Dimuat..." — dipanggil di awal proses ambil data dari sheet.
function showDataLoading(){
  clearTimeout(dataPopupHideTimer);
  const icon = document.getElementById('dataPopupIcon');
  icon.className = 'data-popup-icon loading';
  icon.innerHTML = ICON_LOADING;
  document.getElementById('dataPopupText').textContent = 'Data Sedang Dimuat...';
  document.getElementById('dataPopup').classList.add('active');
}
// Tampilkan popup "Data Berhasil Dimuat" sebentar lalu otomatis hilang.
function showDataLoaded(){
  clearTimeout(dataPopupHideTimer);
  const icon = document.getElementById('dataPopupIcon');
  icon.className = 'data-popup-icon success';
  icon.innerHTML = ICON_SUCCESS;
  document.getElementById('dataPopupText').textContent = 'Data Berhasil Dimuat';
  document.getElementById('dataPopup').classList.add('active');
  dataPopupHideTimer = setTimeout(()=>{ document.getElementById('dataPopup').classList.remove('active'); }, 900);
}
// Sembunyikan popup langsung — dipakai saat proses gagal.
function hideDataPopup(){
  clearTimeout(dataPopupHideTimer);
  document.getElementById('dataPopup').classList.remove('active');
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function currentMonth(){ return new Date().toISOString().slice(0,7); }
// Cek status Aktif tanpa peduli huruf besar/kecil atau spasi (sheet bisa berisi "Aktif"/"AKTIF"/dll).
function isAktif(status){ return String(status||'').trim().toLowerCase()==='aktif'; }

// ================= NAV =================
const titles = {
  dashboard:['Dashboard','Ringkasan operasional hari ini'],
  pelanggan:['Pelanggan','Kelola data pelanggan dan koneksi'],
  paket:['Paket','Kelola daftar paket bandwidth & tarif'],
  payment:['Payment','Input dan pantau pembayaran pelanggan'],
  rekap:['Rekap','Pemasukan, pengeluaran, dan saldo']
};
let currentView = 'dashboard';
document.getElementById('navList').addEventListener('click', e=>{
  const item = e.target.closest('.nav-item');
  if(!item) return;
  // Jaga-jaga tambahan: meski item nav selain "Payment" sudah disembunyikan
  // untuk akun petugas (lihat applyRoleUI), klik ke view selain payment tetap
  // diblokir di sini kalau sampai ada yang memaksa elemen tersembunyi diklik.
  const session = getSession();
  if(session && session.role === 'petugas' && item.dataset.view !== 'payment') return;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  item.classList.add('active');
  const view = item.dataset.view;
  currentView = view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  document.getElementById('pageTitle').textContent = titles[view][0];
  document.getElementById('pageSub').textContent = titles[view][1];
  loadView(view);
});
function loadView(view){
  if(view==='dashboard') loadDashboard();
  if(view==='pelanggan') loadPelangganTable();
  if(view==='paket') loadPaketTable();
  if(view==='payment') loadPaymentInit();
  if(view==='rekap') loadRekap();
}
function refreshCurrentView(){
  const btn = document.getElementById('btnRefresh');
  btn.classList.add('spin');
  loadView(currentView);
  toast('Data diperbarui.');
  setTimeout(()=>btn.classList.remove('spin'), 650);
}

// ================= GRAFIK BATANG (SVG murni, TANPA library/CDN eksternal) =================
// Sebelumnya pakai Chart.js dari CDN, tapi kadang diblokir jaringan/browser sehingga grafik
// gagal dimuat. Diganti grafik garis (line chart) SVG buatan sendiri supaya selalu tampil
// tanpa internet, dengan kurva smooth + area gradient ala dashboard modern.

// Ubah deretan titik menjadi path SVG melengkung mulus (smoothing via Catmull-Rom -> cubic bezier).
function smoothPath_(pts){
  if(pts.length === 0) return '';
  if(pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for(let i = 0; i < pts.length - 1; i++){
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function renderFlowChart_(containerEl, labels, seriesA, seriesB){
  const W = 700, H = 260, padL = 42, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = labels.length || 1;
  const maxVal = Math.max(1, ...seriesA, ...seriesB);
  const pow = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const niceMax = pow * Math.ceil(maxVal / pow);
  const stepX = n > 1 ? plotW / (n - 1) : 0;
  const yScale = v => padT + plotH - (v / niceMax) * plotH;
  const xAt = i => padL + stepX * i;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const y = padT + plotH * (1 - t);
    const val = Math.round(niceMax * t);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eceafc" stroke-width="1"/>
      <text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#9992c2" text-anchor="end">${(val/1000)}k</text>`;
  }).join('');

  const xLabels = labels.map((lab, i) => `<text x="${xAt(i)}" y="${H - 10}" font-size="10.5" fill="#736aa0" text-anchor="middle">${lab}</text>`).join('');

  function buildSeries(series, color, gradId, label){
    const pts = series.map((v, i) => ({x: xAt(i), y: yScale(v)}));
    const linePath = smoothPath_(pts);
    const baseY = padT + plotH;
    const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${baseY} L ${pts[0].x} ${baseY} Z`;
    const dots = pts.map((p, i) => `
      <circle cx="${p.x}" cy="${p.y}" r="${i === pts.length - 1 ? 5 : 3.5}" fill="#fff" stroke="${color}" stroke-width="2.4">
        <title>${label} ${labels[i]}: ${rupiah(series[i])}</title>
      </circle>`).join('');
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}`;
  }

  const expenseLayer = buildSeries(seriesB, 'var(--flow-expense)', 'gradFlowExpense', 'Pengeluaran');
  const incomeLayer = buildSeries(seriesA, 'var(--flow-income)', 'gradFlowIncome', 'Pemasukan');

  containerEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" style="overflow:visible">
      ${gridLines}
      ${expenseLayer}
      ${incomeLayer}
      ${xLabels}
    </svg>
    <div style="display:flex;gap:16px;justify-content:center;margin-top:6px;font-size:11px;color:#736aa0">
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--flow-income);margin-right:5px;"></span>Pemasukan</span>
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--flow-expense);margin-right:5px;"></span>Pengeluaran</span>
    </div>`;
}


async function loadDashboard(){
  showDataLoading();
  try{
    // PENTING (performa): dulu dashboard memanggil server 3x terpisah
    // (getDashboardSummary, getPaymentList, getUnpaidByMonth) — tiap panggilan
    // google.script.run punya overhead round-trip sendiri ke server Apps Script,
    // jadi totalnya lambat. Sekarang backend getDashboardSummary sudah menyertakan
    // semua data yang dibutuhkan (unpaidList & todayPayments) dalam SATU kali
    // panggilan, jadi dashboard hanya perlu satu round-trip ke server.
    const d = await gs('getDashboardSummary');
    document.getElementById('statAktif').textContent = d.aktif;
    document.getElementById('statTotalPelanggan').textContent = 'dari ' + d.totalPelanggan + ' total pelanggan';
    document.getElementById('statPemasukan').textContent = rupiah(d.pemasukanBulanIni);
    document.getElementById('statPengeluaran').textContent = rupiah(d.pengeluaranBulanIni);
    document.getElementById('statSaldo').textContent = rupiah(d.saldoAkhir);
    document.getElementById('statBelumBayar').textContent = d.belumBayarBulanIni + ' pelanggan belum bayar bulan ini';
    document.getElementById('mutedBelumBayar').textContent = d.belumBayarBulanIni + ' pelanggan';

    // Ring "Tingkat Bayar" (goal-card) — label periode dari server (periode tagihan
    // berjalan, digeser -1 bulan dari bulan kalender), BUKAN new Date() langsung,
    // supaya selalu match dengan periode yang dipakai tab Rekap & Pemasukan Bulan Ini.
    document.getElementById('ringPeriodLabel').textContent = 'Periode ' + d.periodeTagihanBulanIniLabel + ' \u00b7 pelanggan sudah bayar';
    // PENTING: sudahBayar & persentase dihitung dari d.wajibBayarBulanIni (pelanggan aktif
    // yang SUDAH terpasang pada/sebelum periode ini), BUKAN d.aktif (total aktif keseluruhan).
    // Dulu pakai d.aktif - d.belumBayarBulanIni, sehingga pelanggan yang baru dipasang
    // SETELAH periode tagihan ikut kehitung "sudah bayar" walau belum pernah transaksi,
    // bikin angka ring lebih besar dari jumlah baris pembayaran asli di tab Payment.
    const sudahBayar = Math.max(0, d.sudahBayarBulanIni);
    const wajibBayar = d.wajibBayarBulanIni || 0;
    const persenBayar = wajibBayar ? Math.round((sudahBayar / wajibBayar) * 100) : 0;
    const circumference = 251;
    document.getElementById('ringCircle').setAttribute('stroke-dashoffset', circumference - (circumference * persenBayar / 100));
    document.getElementById('ringPercentText').textContent = persenBayar + '%';
    document.getElementById('ringPaidCount').textContent = sudahBayar;
    document.getElementById('ringUnpaidCount').textContent = d.belumBayarBulanIni + ' pelanggan belum bayar';

    // Insight banner "hari ini" — sekarang pakai d.todayPaymentsCount/d.todayPaymentsTotal
    // yang sudah dihitung backend, tidak perlu lagi gs('getPaymentList') terpisah.
    document.getElementById('insightText').textContent = d.todayPaymentsCount
      ? 'Hari ini masuk ' + rupiah(d.todayPaymentsTotal) + ' dari ' + d.todayPaymentsCount + ' pembayaran'
      : 'Belum ada pembayaran masuk hari ini';
    document.getElementById('insightSub').textContent = 'Lihat semua di tab Payment \u2192 Data Pembayaran';

    try{
      renderFlowChart_(document.getElementById('chartFlow'), d.bulanLabels, d.pemasukanPerBulan, d.pengeluaranPerBulan);
    }catch(chartErr){
      console.error('Gagal memuat grafik:', chartErr);
      document.getElementById('chartFlow').innerHTML = '<div class="empty-note">Grafik tidak dapat dimuat.</div>';
    }

    // Daftar "Belum Bayar" — sekarang pakai d.unpaidList (sudah dipotong 8 teratas
    // dari backend) & d.unpaidTotalCount, tidak perlu lagi gs('getUnpaidByMonth', ...) terpisah.
    const listEl = document.getElementById('listBelumBayarDash');
    if(d.unpaidTotalCount===0){
      listEl.innerHTML = '<div class="empty-note">Semua pelanggan aktif sudah membayar bulan ini 🎉</div>';
    } else {
      listEl.innerHTML = d.unpaidList.map(p=>`
        <div class="mini-row">
          <div><div class="name">${p.nama}</div><div class="tag">${p.id} &middot; ${p.paket}</div></div>
          <span class="money">${rupiah(p.tarifPaket)}</span>
        </div>`).join('') + (d.unpaidTotalCount>8 ? `<div class="hint" style="text-align:center;padding-top:8px">+${d.unpaidTotalCount-8} lainnya, lihat tab Payment &rarr; Belum Bayar</div>` : '');
    }
    showDataLoaded();
  }catch(err){ hideDataPopup(); toast('Gagal memuat dashboard: '+err.message, true); }
}

// ================= PELANGGAN =================
let pelangganCache = [];
async function loadPelangganTable(){
  const tbody = document.getElementById('tblPelanggan');
  showDataLoading();
  try{
    pelangganCache = await gs('getPelangganList');
    renderPelangganTable();
    showDataLoaded();
  }catch(err){ hideDataPopup(); tbody.innerHTML = `<tr class="loading-row"><td colspan="11">Gagal memuat: ${err.message}</td></tr>`; }
}
function renderPelangganTable(){
  const tbody = document.getElementById('tblPelanggan');
  const q = (document.getElementById('searchPelanggan').value||'').toLowerCase();
  const st = document.getElementById('filterStatusPelanggan').value;
  const rows = pelangganCache.filter(p=>{
    const matchQ = !q || (p.nama+p.id+p.alamat).toLowerCase().includes(q);
    // Bandingkan status tanpa peduli huruf besar/kecil (isAktif_ sama seperti di backend) —
    // sebelumnya pakai '===' case-sensitive sehingga "AKTIF"/"aktif" di sheet tidak match "Aktif".
    const matchS = !st || (st==='Aktif' ? isAktif(p.status) : !isAktif(p.status));
    return matchQ && matchS;
  });
  if(rows.length===0){ tbody.innerHTML = '<tr class="loading-row"><td colspan="11">Tidak ada data.</td></tr>'; return; }
  tbody.innerHTML = rows.map(p=>`
    <tr>
      <td>${p.no}</td>
      <td><span class="id-chip">${p.id}</span></td>
      <td><strong>${p.nama}</strong></td>
      <td>${p.alamat||''}</td>
      <td>${p.noHp||''}</td>
      <td>${p.paket||''}</td>
      <td class="money">${rupiah(p.tarifPaket)}</td>
      <td class="mono" style="font-size:12px;color:var(--ink-400)">${p.secretMikrotik||'-'}</td>
      <td>${p.tglPasang||''}</td>
      <td><span class="badge ${isAktif(p.status)?'badge-aktif':'badge-nonaktif'}"><span class="signal-badge"><i></i><i></i><i></i></span>${p.status}</span></td>
      <td class="actions-cell">
        <button class="icon-btn" title="Edit" onclick='editPelanggan(${JSON.stringify(p).replace(/'/g,"&apos;")})'>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
        <button class="icon-btn danger" title="Hapus" onclick="deletePelangganRow('${p.id}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </td>
    </tr>`).join('');
}
document.getElementById('searchPelanggan').addEventListener('input', renderPelangganTable);
document.getElementById('filterStatusPelanggan').addEventListener('change', renderPelangganTable);

async function openPelangganModal(){
  document.getElementById('formPelanggan').reset();
  document.getElementById('pelIdEdit').value = '';
  document.getElementById('modalPelangganTitle').textContent = 'Tambah Pelanggan';
  document.getElementById('pelTglPasang').value = todayISO();
  document.getElementById('pelIdHint').textContent = 'ID pelanggan akan dibuat otomatis (format MJ-000).';
  await populatePaketDropdown('pelPaket');
  document.getElementById('modalPelanggan').classList.add('active');
}
function editPelanggan(p){
  document.getElementById('formPelanggan').reset();
  document.getElementById('modalPelangganTitle').textContent = 'Edit Pelanggan &middot; ' + p.id;
  document.getElementById('pelIdEdit').value = p.id;
  document.getElementById('pelNama').value = p.nama;
  document.getElementById('pelAlamat').value = p.alamat;
  document.getElementById('pelNoHp').value = p.noHp;
  document.getElementById('pelTglPasang').value = p.tglPasang;
  document.getElementById('pelTarif').value = p.tarifPaket;
  document.getElementById('pelSecret').value = p.secretMikrotik;
  document.getElementById('pelStatus').value = p.status;
  document.getElementById('pelIdHint').textContent = 'ID pelanggan: ' + p.id;
  populatePaketDropdown('pelPaket').then(()=>{ document.getElementById('pelPaket').value = p.paket; });
  document.getElementById('modalPelanggan').classList.add('active');
}
async function populatePaketDropdown(selectId){
  const paket = await gs('getPaketList');
  const sel = document.getElementById(selectId);
  sel.innerHTML = paket.map(p=>`<option value="${p.nama}" data-tarif="${p.tarif}">${p.nama} (${p.bandwidth})</option>`).join('');
}
function autofillTarif(){
  const sel = document.getElementById('pelPaket');
  const opt = sel.options[sel.selectedIndex];
  if(opt) document.getElementById('pelTarif').value = opt.dataset.tarif;
}
async function submitPelanggan(e){
  e.preventDefault();
  const idEdit = document.getElementById('pelIdEdit').value;
  const data = {
    nama: document.getElementById('pelNama').value,
    alamat: document.getElementById('pelAlamat').value,
    noHp: document.getElementById('pelNoHp').value,
    paket: document.getElementById('pelPaket').value,
    tarifPaket: document.getElementById('pelTarif').value,
    secretMikrotik: document.getElementById('pelSecret').value,
    tglPasang: document.getElementById('pelTglPasang').value,
    status: document.getElementById('pelStatus').value
  };
  try{
    if(idEdit){ await gs('updatePelanggan', idEdit, data); toast('Data pelanggan diperbarui.'); }
    else{ const r = await gs('addPelanggan', data); toast('Pelanggan ditambahkan: ' + r.id); }
    closeModal('modalPelanggan');
    loadPelangganTable();
  }catch(err){ toast('Gagal menyimpan: '+err.message, true); }
}
async function deletePelangganRow(id){
  if(!confirm('Hapus pelanggan ' + id + '? Tindakan ini tidak bisa dibatalkan.')) return;
  try{ await gs('deletePelanggan', id); toast('Pelanggan dihapus.'); loadPelangganTable(); }
  catch(err){ toast('Gagal menghapus: '+err.message, true); }
}

// ================= PAKET =================
let paketCache = [];
async function loadPaketTable(){
  const tbody = document.getElementById('tblPaket');
  showDataLoading();
  try{
    paketCache = await gs('getPaketList');
    if(paketCache.length===0){ tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Belum ada paket.</td></tr>'; showDataLoaded(); return; }
    tbody.innerHTML = paketCache.map(p=>`
      <tr>
        <td>${p.no}</td><td><strong>${p.nama}</strong></td><td>${p.bandwidth}</td><td class="money">${rupiah(p.tarif)}</td>
        <td class="actions-cell">
          <button class="icon-btn" onclick='editPaket(${JSON.stringify(p).replace(/'/g,"&apos;")})'>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="icon-btn danger" onclick="deletePaketRow('${p.nama}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </td>
      </tr>`).join('');
    showDataLoaded();
  }catch(err){ hideDataPopup(); tbody.innerHTML = `<tr class="loading-row"><td colspan="5">Gagal memuat: ${err.message}</td></tr>`; }
}
function openPaketModal(){
  document.getElementById('formPaket').reset();
  document.getElementById('pakNamaEdit').value = '';
  document.getElementById('modalPaketTitle').textContent = 'Tambah Paket';
  document.getElementById('modalPaket').classList.add('active');
}
function editPaket(p){
  document.getElementById('modalPaketTitle').textContent = 'Edit Paket';
  document.getElementById('pakNamaEdit').value = p.nama;
  document.getElementById('pakNama').value = p.nama;
  document.getElementById('pakBandwidth').value = p.bandwidth;
  document.getElementById('pakTarif').value = p.tarif;
  document.getElementById('modalPaket').classList.add('active');
}
async function submitPaket(e){
  e.preventDefault();
  const namaLama = document.getElementById('pakNamaEdit').value;
  const data = { nama: document.getElementById('pakNama').value, bandwidth: document.getElementById('pakBandwidth').value, tarif: document.getElementById('pakTarif').value };
  try{
    if(namaLama){ await gs('updatePaket', namaLama, data); toast('Paket diperbarui.'); }
    else{ await gs('addPaket', data); toast('Paket ditambahkan.'); }
    closeModal('modalPaket');
    loadPaketTable();
  }catch(err){ toast('Gagal menyimpan: '+err.message, true); }
}
async function deletePaketRow(nama){
  if(!confirm('Hapus paket "'+nama+'"?')) return;
  try{ await gs('deletePaket', nama); toast('Paket dihapus.'); loadPaketTable(); }
  catch(err){ toast('Gagal menghapus: '+err.message, true); }
}

// ================= PAYMENT =================
function switchPaymentTab(sub){
  document.querySelectorAll('#view-payment .tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector(`#view-payment .tab-btn[data-sub="${sub}"]`).classList.add('active');
  document.querySelectorAll('#view-payment .subview').forEach(v=>v.classList.remove('active'));
  document.getElementById('sub-'+sub).classList.add('active');
  if(sub==='pay-data') loadPaymentTable();
  if(sub==='pay-unpaid'){
    document.getElementById('filterPeriodeUnpaid').value = document.getElementById('filterPeriodeUnpaid').value || currentMonth();
    loadUnpaidTable();
  }
}
let pelangganCacheForPayment = [];
async function loadPaymentInit(){
  document.getElementById('payPeriode').value = currentMonth();
  document.getElementById('payTanggal').value = todayISO();
  showDataLoading();
  try{
    const pelanggan = await gs('getPelangganList');
    pelangganCacheForPayment = pelanggan.filter(p=>isAktif(p.status));
    const sel = document.getElementById('payIdPelanggan');
    sel.innerHTML = pelangganCacheForPayment.map(p=>`<option value="${p.id}">${p.id} — ${p.nama}</option>`).join('');
    isiJumlahDariPelanggan();
    showDataLoaded();
  }catch(err){ hideDataPopup(); toast('Gagal memuat data pelanggan: '+err.message, true); }
}
function isiJumlahDariPelanggan(){
  const id = document.getElementById('payIdPelanggan').value;
  const p = pelangganCacheForPayment.find(x=>x.id===id);
  if(p) document.getElementById('payJumlah').value = p.tarifPaket || 0;
  updatePayTotalPreview();
}
document.getElementById('payIdPelanggan')?.addEventListener('change', isiJumlahDariPelanggan);

// Preview total setelah diskon — dihitung LIVE di frontend saja (murni tampilan),
// perhitungan final tetap dilakukan ulang di backend saat disimpan (addPayment).
function updatePayTotalPreview(){
  const jumlah = Number(document.getElementById('payJumlah').value) || 0;
  const diskonRaw = document.getElementById('payDiskon').value;
  const diskon = diskonRaw === '' ? 0 : Math.max(0, Math.min(100, Number(diskonRaw) || 0));
  const el = document.getElementById('payTotalPreview');
  if(!jumlah || diskon <= 0){ el.textContent = ''; return; }
  const nominal = Math.round(jumlah * diskon / 100);
  const total = jumlah - nominal;
  el.textContent = 'Diskon ' + diskon + '% = -' + rupiah(nominal) + '  →  Total bayar ' + rupiah(total);
}
document.getElementById('payJumlah')?.addEventListener('input', updatePayTotalPreview);
document.getElementById('payDiskon')?.addEventListener('input', updatePayTotalPreview);
document.getElementById('formPayment')?.addEventListener('input', () => {
  if(window.lastPayment) setCetakStrukEnabled(false);
});
document.getElementById('formPayment')?.addEventListener('change', () => {
  if(window.lastPayment) setCetakStrukEnabled(false);
});
// Tombol "Cetak Struk Pembayaran" hanya aktif setelah data pembayaran berhasil
// disimpan (window.lastPayment terisi). Setiap kali form dibuka ulang / direset
// tanpa penyimpanan baru, tombol dikunci lagi supaya tidak mencetak struk yang
// sudah tidak sesuai dengan isi form saat ini.
function setCetakStrukEnabled(enabled){
  const btn = document.getElementById('btnCetakStruk');
  if(!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '.45';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}
async function submitPayment(e){
  e.preventDefault();
  const data = {
    idPelanggan: document.getElementById('payIdPelanggan').value,
    periode: document.getElementById('payPeriode').value,
    tglBayar: document.getElementById('payTanggal').value,
    jumlah: document.getElementById('payJumlah').value,
    diskon: document.getElementById('payDiskon').value,
    metode: document.getElementById('payMetode').value,
    catatan: document.getElementById('payCatatan').value
  };
  try{
    const res = await gs('addPayment', data);
    if(res && res.success===false){ toast(res.message || 'Gagal menyimpan pembayaran.', true); return; }
    toast('Pembayaran tersimpan.');
    window.lastPayment = res.payment || null;
    setCetakStrukEnabled(true);
    document.getElementById('formPayment').reset();
    document.getElementById('payPeriode').value = currentMonth();
    document.getElementById('payTanggal').value = todayISO();
    isiJumlahDariPelanggan();
    updatePayTotalPreview();
  }catch(err){ toast('Gagal menyimpan: '+err.message, true); }
}
async function loadPaymentTable(){
  const tbody = document.getElementById('tblPayment');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="9">Memuat data…</td></tr>';
  showDataLoading();
  try{
    let list = await gs('getPaymentList');
    const filt = document.getElementById('filterPeriodePayment').value;
    if(filt) list = list.filter(p=>p.periode===filt);
    if(list.length===0){ tbody.innerHTML = '<tr class="loading-row"><td colspan="10">Tidak ada data.</td></tr>'; showDataLoaded(); return; }
    tbody.innerHTML = list.slice().reverse().map(p=>`
      <tr>
        <td>${p.no}</td><td><span class="id-chip">${p.idPelanggan}</span></td><td>${p.nama}</td><td>${p.periodeLabel||p.periode}</td>
        <td>${p.tglBayar}</td><td class="money pos">${rupiah(p.jumlah)}</td><td>${p.diskonPersen ? p.diskonPersen+'%' : '-'}</td><td>${p.metode}</td><td>${p.catatan||'-'}</td>
        <td class="actions-cell">
          <button class="icon-btn danger" onclick="deletePaymentRow(${p.no})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </td>
      </tr>`).join('');
    showDataLoaded();
  }catch(err){ hideDataPopup(); tbody.innerHTML = `<tr class="loading-row"><td colspan="10">Gagal memuat: ${err.message}</td></tr>`; }
}
async function deletePaymentRow(no){
  if(!confirm('Hapus data pembayaran ini?')) return;
  try{ await gs('deletePayment', no); toast('Pembayaran dihapus.'); loadPaymentTable(); }
  catch(err){ toast('Gagal menghapus: '+err.message, true); }
}
async function loadUnpaidTable(){
  const tbody = document.getElementById('tblUnpaid');
  const periode = document.getElementById('filterPeriodeUnpaid').value || currentMonth();
  tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Memuat data…</td></tr>';
  // Reset angka card total sebelum data baru datang, supaya tidak "nyangkut"
  // menampilkan angka dari periode sebelumnya saat sedang memuat.
  document.getElementById('totalBelumBayarUnpaid').textContent = '–';
  showDataLoading();
  try{
    const list = await gs('getUnpaidByMonth', periode);
    // Update card "Total Belum Bayar" sesuai jumlah hasil filter periode ini.
    document.getElementById('totalBelumBayarUnpaid').textContent = list.length + ' pelanggan';
    if(list.length===0){ tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Semua pelanggan aktif sudah membayar periode ini 🎉</td></tr>'; showDataLoaded(); return; }
    tbody.innerHTML = list.map(p=>`
      <tr><td><span class="id-chip">${p.id}</span></td><td><strong>${p.nama}</strong></td><td>${p.noHp||''}</td><td>${p.paket}</td><td class="money">${rupiah(p.tarifPaket)}</td></tr>
    `).join('');
    showDataLoaded();
  }catch(err){ hideDataPopup(); tbody.innerHTML = `<tr class="loading-row"><td colspan="5">Gagal memuat: ${err.message}</td></tr>`; document.getElementById('totalBelumBayarUnpaid').textContent = '–'; }
}

// ================= REKAP =================
function updateJumlahPreview(){
  const pcs = Number(document.getElementById('expPcs').value) || 0;
  const harga = Number(document.getElementById('expHarga').value) || 0;
  document.getElementById('expJumlahPreview').value = rupiah(pcs * harga);
}
document.getElementById('expPcs')?.addEventListener('input', updateJumlahPreview);
document.getElementById('expHarga')?.addEventListener('input', updateJumlahPreview);

async function submitPengeluaran(e){
  e.preventDefault();
  const data = {
    tanggal: document.getElementById('expTanggal').value,
    keterangan: document.getElementById('expKeterangan').value,
    pcs: document.getElementById('expPcs').value,
    hargaPerPcs: document.getElementById('expHarga').value
  };
  try{
    const res = await gs('addPengeluaran', data);
    if(res && res.success===false){ toast(res.message || 'Gagal menyimpan pengeluaran.', true); return; }
    toast('Pengeluaran tersimpan.');
    document.getElementById('formPengeluaran').reset();
    document.getElementById('expTanggal').value = todayISO();
    document.getElementById('expPcs').value = 1;
    updateJumlahPreview();
    loadRekap();
    loadSaldoAkhir();
  }catch(err){ toast('Gagal menyimpan: '+err.message, true); }
}
async function loadSaldoAkhir(){
  try{
    const s = await gs('getSaldoAkhir');
    document.getElementById('saldoAkhirBesar').textContent = rupiah(s.saldoAkhir);
    document.getElementById('saldoTotalPemasukan').textContent = rupiah(s.totalPemasukan);
    document.getElementById('saldoTotalPengeluaran').textContent = rupiah(s.totalPengeluaran);
  }catch(err){ toast('Gagal memuat saldo: '+err.message, true); }
}
async function loadRekap(){
  document.getElementById('expTanggal').value = document.getElementById('expTanggal').value || todayISO();
  document.getElementById('expPcs').value = document.getElementById('expPcs').value || 1;
  updateJumlahPreview();
  document.getElementById('filterPeriodeRekap').value = document.getElementById('filterPeriodeRekap').value || currentMonth();
  showDataLoading();
  loadSaldoAkhir();
  try{
    const r = await gs('getRekapBulanan', document.getElementById('filterPeriodeRekap').value);
    document.getElementById('rekapPemasukan').textContent = rupiah(r.pemasukanBulan);
    document.getElementById('rekapPemasukanSub').textContent = 'Periode ' + r.periodePemasukanLabel;
    document.getElementById('rekapPengeluaran').textContent = rupiah(r.pengeluaranBulan);
    const listEl = document.getElementById('listRincianPengeluaran');
    if(r.rincianPengeluaran.length===0){
      listEl.innerHTML = '<div class="empty-note">Tidak ada pengeluaran pada periode ini.</div>';
    }else{
      listEl.innerHTML = r.rincianPengeluaran.slice().reverse().map(p=>`
        <div class="mini-row">
          <div><div class="name">${p.keterangan}</div><div class="tag">${p.pcs} pcs &times; ${rupiah(p.hargaPerPcs)} &middot; ${p.tanggal}</div></div>
          <span class="money neg">- ${rupiah(p.jumlah)}</span>
        </div>`).join('');
    }
    showDataLoaded();
  }catch(err){ hideDataPopup(); toast('Gagal memuat rekap: '+err.message, true); }
}
document.getElementById('filterPeriodeRekap')?.addEventListener('change', loadRekap);

// ================= MODAL / MISC =================
function closeModal(id){ document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.modal-overlay').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) m.classList.remove('active'); });
});

document.getElementById('todayPill').textContent = new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

// initial load — cek dulu apakah sudah ada sesi login yang tersimpan di tab
// browser ini (sessionStorage), kalau ada langsung masuk ke app tanpa perlu
// login ulang; kalau belum, layar login (sudah tampil secara default) menunggu.
(function initAuth(){
  const session = getSession();
  if(session && AUTH_ACCOUNTS[session.username] && AUTH_ACCOUNTS[session.username].role === session.role){
    currentView = session.role === 'petugas' ? 'payment' : 'dashboard';
    enterApp();
  }
})();

