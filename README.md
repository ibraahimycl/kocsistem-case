# TaskFlow — Kanban Proje Yönetim Tahtası

Küçük yazılım ekipleri için tasarlanmış, **gerçek zamanlı**, **güvenli** ve **performans odaklı** bir Kanban board uygulaması. Kullanıcılar board oluşturabilir, sütunlar ve kartlar ekleyebilir, sürükle-bırak ile görevleri yönetebilir. Proje; sıralama algoritması, veritabanı mimarisi ve güvenlik katmanı olmak üzere üç temel eksen üzerinde bilinçli mühendislik kararlarıyla geliştirilmiştir.

🔗 **Canlı Demo:** [Vercel üzerinde çalışır durumda](https://kocsistem-case.vercel.app)

---

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Sürükle-Bırak | dnd-kit (core + sortable) |
| Backend | Next.js API Routes (Server-side) |
| Veritabanı | Supabase (PostgreSQL) |
| Auth | Supabase Auth + HMAC-signed HttpOnly Cookie |
| Realtime | Supabase Realtime (postgres_changes) |
| Deployment | Vercel |

---

## Beklentiler ve Düşünülmesi Gereken Sorular — Çözümlerim

### 1. Kullanıcılar hesap oluşturup giriş yapabilmeli

**Çözüm:** Supabase Auth üzerinde email + password tabanlı authentication uygulandı. Session yönetimi tamamen **sunucu taraflı** çalışır: oturum bilgileri (access_token, refresh_token, expires_at) `HMAC-SHA256` ile imzalanarak `HttpOnly`, `SameSite=lax`, `Secure` cookie içinde saklanır. Bu sayede XSS saldırılarına karşı token korunur. Token süresi dolmaya yakın (30 sn buffer) otomatik `refreshSession` çalışır — kullanıcı hiçbir şey fark etmez.
  - İmzalama: `crypto.createHmac("sha256", secret)` ile `base64url` payload imzalanır.
  - Doğrulama: `crypto.timingSafeEqual` ile timing-safe karşılaştırma yapılır.
  - Kayıt sırasında `profiles` tablosuna `display_name` otomatik yazılır, `NOT NULL` ve `char_length >= 2` constraint'i uygulanır.

### 2. Board oluşturulabilmeli, sütunlar ve kartlar eklenebilmeli

**Çözüm:** Board oluşturma tek bir PostgreSQL `SECURITY DEFINER` fonksiyonu (`create_board_with_room`) içinde atomik olarak gerçekleşir:
1. Board kaydı oluşturulur
2. Kurucu otomatik olarak `admin` + `active` statüsüyle `board_members` tablosuna eklenir
3. Varsayılan üç sütun (Backlog, In Progress, Done) `order_index: 10000, 20000, 30000` aralıklarıyla oluşturulur

Tüm bu işlemler tek bir transaction içinde olduğundan, yarım kalan oluşturma riski yoktur. Sütun ekleme, yeniden adlandırma ve silme yalnızca board'un kurucusuna (`created_by`) RLS policy'leri ile sınırlanmıştır. Kart ekleme, düzenleme ve taşıma ise `editor` veya `admin` rollerine açıktır.

### 3. Kartlar sürükle-bırak ile sütunlar arasında taşınabilmeli

**Çözüm — Kütüphane Seçimi:** `dnd-kit` tercih edildi. Gerekçeler:
- **Aktif bakım:** `react-beautiful-dnd` artık bakım almayı bıraktı; `dnd-kit` hâlen aktif geliştirme altında.
- **Modüler mimari:** `@dnd-kit/core` + `@dnd-kit/sortable` ayrı paketlerle sadece ihtiyaç duyulan kod yüklenir.
- **Sensor desteği:** `PointerSensor`, `TouchSensor`, `KeyboardSensor` ayrı ayrı yapılandırılabilir. Mobilde sürükleme ve sayfa kaydırma çakışması, `PointerSensor` üzerindeki `distance: 6` ve ayrılmış drag-handle (kart üzerindeki renkli çubuk) ile çözüldü.
- **Performans:** dnd-kit transform'ları CSS üzerinden uyguladığı için DOM re-render minimumda kalır.

**Görsel İpuçları:** Sürüklenen kart `opacity: 0.40` ile soluklaştırılır, `DragOverlay` ile kartın bir gölge kopyası fare imlecini takip eder. Hedef sütun `ring-2 ring-sky-500/70` ile vurgulanır.

**Sütun Sıralaması:** Sütunlar da sürükle-bırak ile yeniden sıralanabilir (yalnızca board kurucusu için). `SortableContext` + `horizontalListSortingStrategy` kullanılarak yatay sıralama sağlanır.

### 4. Kart detayları (başlık, açıklama) düzenlenebilmeli

**Çözüm:** Kart detay modal'ında şu alanlar düzenlenebilir: başlık, açıklama, başlangıç tarihi, bitiş tarihi. Ek olarak:
- **Checklist sistemi:** Her karta alt görev listesi eklenebilir. Checklist item'ları başlık + açıklama + tamamlanma durumu (is_done) içerir; ilerleme oranı (ör. 3/5) canlı görüntülenir.
- **Accent renk:** Her kartın sol şeridine tıklanarak 5 farklı renk (red, blue, green, pink, orange) atanabilir. Renk seçimi `DB constraint` ile korunur: `CHECK(accent_color IN ('red','blue','green','pink','orange'))`.
- **Atama & Etiket:** `cards` tablosunda `assignee_id`, `labels (jsonb)` alanları hazır.

### 5. Sıralama sayfa yenilemesinde korunmalı — Sıralama verisi nasıl saklanmalı?

Bu, projenin **en kritik mühendislik kararıdır**. Araştırma sürecinde Jira, Trello ve Linear gibi ürünlerin çözümlerini inceledim. Jira'nın LexoRank (string tabanlı) ve Trello'nun ardışık tamsayı yaklaşımlarını doğrudan benimsemeyi doğru bulmadım — önce kendi sıralama fikrimi oluşturdum, sonra mevcut araştırmaları inceleyerek çözümümü olgunlaştırdım.

#### Algoritma: Spaced Integers + Elastic Window + Global Rebalance

Üç katmanlı bir sıralama algoritması uyguladık:

**Katman 1 — Spaced Integers (Aralıklı Tamsayılar):**
- Yeni kartlar `10000`, `20000`, `30000` gibi geniş aralıklarla `order_index` alır (step = 10.000).
- İki kart arasına ekleme: `new = floor((left + right) / 2)`. Örneğin 10000 ile 20000 arasına → 15000.
- **Veritabanında sadece 1 satır güncellenir** — O(1) write.

**Katman 2 — Elastic Window (Esnek Pencere) — Lokal Sıkışma Çözümü:**
- İki kart arasında tamsayı boşluğu kalmadığında (ör. 10000 ile 10001 arası), tüm sütunu yeniden numaralamak yerine:
  - `radius = 1` ile başlayan bir pencere açılır.
  - Pencere içindeki sol sınır (`left_bound`) ve sağ sınır (`right_bound`) belirlenir.
  - Bu sınırlar arasındaki boşluk penceredeki kart sayısına eşit dağıtılır:
    ```
    dist_step = floor((right_bound - left_bound) / (window_count + 2))
    ```
  - Eğer `dist_step >= 1` ise pencere yeterli — yalnızca penceredeki 3-5 kart güncellenir.
  - Yeterli değilse `radius++` ile pencere genişletilir ve tekrar denenir.
- **Sonuç:** Çoğu sıkışma durumunda 3-5 satır güncellemeyle sorun çözülür.

**Katman 3 — Global Rebalance (Son Çare):**
- Elastic window, sütunun başından sonuna kadar genişlemesine rağmen yer bulunamadıysa, **yalnızca o sütundaki** tüm kartlar `10000, 20000, 30000 ...` şeklinde baştan numaralandırılır.
- Bu durum pratikte binlerce kart sürüklenmedikçe oluşmaz.

```
Normal taşıma:        1 satır güncelleme   → %99+ durum
Elastic Window:       3-5 satır güncelleme  → nadir
Global Rebalance:     N satır güncelleme    → son çare
```

> **Neden LexoRank kullanmadım?** LexoRank string tabanlıdır, karşılaştırma maliyeti tamsayıya göre daha yüksektir ve string'lerin sonsuz uzaması riski vardır. Aralıklı tamsayılar ile aynı "araya ekleme" avantajını elde ederken `bigint` indekslemenin performans avantajından yararlanıyoruz. Elastic window mekanizması da LexoRank'ın "rebalance bucket" konseptinden ilham almakla birlikte, lokal pencere genişletme yaklaşımıyla daha granüler ve verimli çalışır.

> **Neden ardışık tamsayılar (1, 2, 3) kullanmadım?** Her araya eklemede, eklenen konumdan sonraki tüm kartların sıra numarasını +1 artırmak gerekir — O(N) write. Yoğun drag-drop senaryolarında bu kabul edilemez.

**Tüm bu mantık PostgreSQL'de `move_card_transactional` fonksiyonu olarak çalışır** — `SECURITY DEFINER`, `FOR UPDATE` satır kilitleri ve tek bir transaction ile race condition'a karşı koruma sağlanır.

### 6. Uygulama Vercel'da çalışır durumda olmalı

**Çözüm:** Uygulama Vercel'a deploy edilmiştir ve Next.js API Routes üzerinden çalışır. `next.config.mjs` ile gerekli yapılandırmalar sağlanmıştır.

### 7. Mobil cihazlarda sürükle-bırak nasıl çalışacak?

**Çözüm:** Her kartın sol tarafında renkli bir **drag handle şeridi** bulunur. Bu şerit:
- **Tap:** Renk seçici açılır.
- **Hold & Drag:** Kartı sürüklemeye başlar.

`PointerSensor` üzerinde `distance: 6` activation constraint ile parmağın hafif kaymasıyla tetiklenmesi engellenir. `TouchSensor` ayrıca yapılandırılarak mobil deneyim iyileştirilmiştir. Tap ve drag çakışması, `pointer distance` + `elapsed time` kontrolü (< 12px ve < 650ms ise tap) ile çözülür. Sütunlar yatay kaydırmalı (`overflow-x-auto`) bir alan içinde yer alarak küçük ekranlarda tüm board'a erişim sağlanır.

### 8. Sütunların sırası da değiştirilebilir mi olmalı?

**Çözüm:** Evet. Sütunlar da sürükle-bırak ile yeniden sıralanabilir. Bu özellik **yalnızca board kurucusuna** açıktır.
- Frontend'de `SortableContext` + `horizontalListSortingStrategy` kullanılır.
- Backend'de **iki fazlı güncelleme** uygulanır. Sorun şu: `columns` tablosunda `UNIQUE(board_id, order_index)` constraint var — aynı board'da iki sütun aynı sıra numarasına sahip olamaz. Sütunları doğrudan hedef değerlerine yazmaya çalışırsak çakışma oluşur. Örnek:

  ```
  Başlangıç durumu:   Backlog=10000   In Progress=20000   Done=30000
  Hedef (Done'ı başa al): Done=10000   Backlog=20000   In Progress=30000

  Naif yaklaşım: Done'a 10000 yazmaya çalış → Backlog zaten 10000 → UNIQUE ihlali!

  Çözümüm:
  Faz 1 → Hepsini geçici aralığa taşı (+1.000.000.000 offset):
     Backlog=1000010000, In Progress=1000020000, Done=1000030000
  Faz 2 → Artık çakışma riski yok, hedef değerleri yaz:
     Done=10000, Backlog=20000, In Progress=30000
  ```
- Sütun taşıma da debounce mekanizmasıyla optimize edilir.

### 9. Kartlara etiket, son teslim tarihi, sorumlu kişi eklemeyi düşünecek misin?

**Çözüm:**
- ✅ **Son teslim tarihi (due_date):** Hem oluşturma hem düzenleme modal'ında bulunur.
- ✅ **Başlangıç tarihi (start_date):** İlave olarak eklendi — görev süresi hesaplanabilir.
- ⏸️ **Etiketler (labels):** Veritabanında `jsonb` dizisi olarak altyapısı hazırlandı, ancak temel akışa odaklanmak adına frontend entegrasyonundan vazgeçildi.
- ⏸️ **Sorumlu kişi (assignee_id):** Veritabanında FK olarak alan hazırlandı; ancak mevcut yapıda board kurucusu (admin) doğrudan tüm kartların sorumlusu konumunda olduğundan, kart bazlı atama frontend'e taşınmadı.
- ✅ **Checklist:** Alt görev listesi tam fonksiyonel — oluşturma, düzenleme, silme, tamamlama.
- ✅ **Accent renk:** 5 renk seçeneği, DB constraint korumalı.

### 10. Board paylaşma özelliği olacak mı?

**Çözüm — RBAC Oda Mimarisi:**

Basit URL paylaşımı yerine, Supabase **Row Level Security (RLS)** ile korunan kurumsal seviye bir oda sistemi tasarlandı:

1. **Oda oluşturma:** Board oluşturulduğunda benzersiz bir `room_code` (4-8 hane, `[A-Z0-9]`) otomatik üretilir. Kurucu bir `room_password` belirler; şifre `bcrypt` ile hash'lenerek saklanır.

2. **Katılım isteği:** Kullanıcı, room code + room password ile katılım talep eder (`request_join_board` RPC). Viewer veya Editor rolü seçer. Başarılı şifre doğrulamasından sonra `board_members` tablosunda `status: pending` kaydı oluşur.

3. **Onay mekanizması:** Pending kullanıcı tahtayı **göremez**. Board admini, "Requests" panelinden isteği onaylar (`approve`) veya reddeder (`reject`). Onaylanan kullanıcı `status: active` olur.

4. **RLS koruması:** Veritabanı seviyesinde:
   - `status: active` olmayan kullanıcılar board'un kartlarını `SELECT` edemez.
   - `editor` veya `admin` olmayan kullanıcılar kart/sütun `INSERT`, `UPDATE`, `DELETE` yapamaz.
   - Sütun yönetimi (ekleme/silme/yeniden adlandırma) yalnızca `boards.created_by` olan kullanıcıya açıktır.
   - Bu kurallar API bypass edilse bile geçerlidir — güvenlik veritabanı katmanındadır.

5. **Oda şifresi sıfırlama:** Board kurucusu istediği zaman oda şifresini değiştirebilir (`reset_board_room_password` RPC).

6. **Roller:**
   - `admin` — Board kurucusu. Tam yetki: üye yönetimi, sütun yönetimi, kart yönetimi.
   - `editor` — Kart ekleme, düzenleme, taşıma yapabilir. Sütun yönetemez.
   - `viewer` — Sadece görüntüleyebilir.

### 11. Aktivite geçmişi (kartın hangi sütunlar arasında ne zaman taşındığı) değerli mi?

**Çözüm:** Evet. `activity_logs` tablosu **trigger tabanlı otomatik kayıt** yapar:
- `card_created` — Kart oluşturulduğunda
- `card_updated` — Kart detayları değiştiğinde
- `card_moved` — `from_column_id`, `to_column_id`, `from_order_index`, `to_order_index` ile tam hareket izi
- `card_deleted` — Silinen kartın başlığı metadata'da saklanır
- `member_requested`, `member_approved`, `member_rejected` — Üye hareketleri

Tüm bunlar `AFTER INSERT/UPDATE/DELETE` trigger'ları (`log_card_activity`) ile otomatik oluşur — geliştirici log'u hatırlamak zorunda kalmaz.

### 12. Performans: çok sayıda kart olduğunda sürükle-bırak akıcı kalıyor mu?

**Çözüm — Çok Katmanlı Performans Stratejisi:**

**a) Optimistic UI:**
Kart sürüklenip bırakıldığında state anında güncellenir — backend yanıtı beklenmez. Kullanıcı gecikme hissetmez.

**b) Debounced Persistence:**
Her sürükleme anında veritabanına yazmak yerine, taşıma istekleri bir kuyruğa alınır:
- **800ms sessizlik** sonrası yazılır (debounce).
- **3000ms maxWait** ile uzun serilerde zorunlu flush yapılır.
- Sekme gizlendiğinde (`visibilitychange`) veya sayfa kapatılırken (`beforeunload`) bekleyen taşımalar flush edilir.
- Kuyruktaki veriler `localStorage`'da da yedeklenir — sayfa çökmesinde bile veri kaybolmaz.

**c) Board Revision Tracking:**
`boards` tablosunda `revision` sütunu bulunur. Her taşıma sonrası revision artar. Bu, multi-user ortamda eski yanıtların yeni state'i ezmesini önler — stale response detection.

**d) Stale Load Koruması:**
Board yüklemelerinde sequence numarası (`boardLoadSeqRef`) tutulur. Gecikmeli bir yanıt gelirse `seq < latestAppliedBoardLoadSeqRef` kontrolüyle reddedilir.

**e) Supabase Realtime:**
Board'daki kart değişiklikleri (`INSERT`, `UPDATE`, `DELETE`) Realtime channel üzerinden dinlenir. Başka bir kullanıcının yaptığı değişiklikler anlık olarak UI'a yansır — full board refetch gerekmez.

**f) Full Refetch Kaldırıldı:**
Bir kart taşındıktan sonra board'u komple tekrar çekme davranışı gösterilmez. Optimistic UI + Realtime + Board Revision kombinasyonu ile gereksizleştirildi. Bu, özellikle çok kartlı board'larda dramatik performans iyileşmesi sağlar.

---

  
### Öne Çıkan Veritabanı Özellikleri

- **Composite Foreign Key:** `cards(board_id, column_id) → columns(board_id, id)` — Bir kart yanlış board'un sütununa atanamaz.
- **Unique Constraint:** `UNIQUE(column_id, order_index)` ve `UNIQUE(board_id, order_index)` — Aynı sütunda iki kart aynı sıraya sahip olamaz.
- **Trigger'lar:** `set_updated_at()` — Her tabloda `updated_at` otomatik güncellenir. `log_card_activity()` — Kart hareketleri otomatik loglanır.
- **Check Constraint'ler:** `order_index > 0`, `char_length(trim(name)) >= 1`, `room_code ~ '^[A-Z0-9]{4,8}$'`, `accent_color IN (...)`.
- **İndeksler:** `idx_cards_column_order`, `idx_cards_board`, `idx_board_members_board_status` gibi indekslerle sorgu performansı optimize edildi.
- **Bcrypt şifreleme:** Oda şifreleri `extensions.crypt()` + `extensions.gen_salt('bf')` ile hash'lenir.

---

## Sıralama Formülleri

Araya yerleştirme (iki komşunun ortası):

$$V_{insert} = \left\lfloor \frac{V_{left} + V_{right}}{2} \right\rfloor$$

Elastic window'da eşit dağıtım:

$$\Delta = \left\lfloor \frac{R_{bound} - L_{bound}}{N_{window} + 2} \right\rfloor$$

---

## Proje Yapısı

```
taskflow/
├── src/
│   ├── app/
│   │   ├── page.js                    # Ana Kanban board UI
│   │   ├── layout.js                  # Root layout
│   │   ├── globals.css                # Global stiller
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login/route.js     # Email + password giriş
│   │       │   ├── signup/route.js    # Hesap oluşturma
│   │       │   ├── logout/route.js    # Oturum kapatma
│   │       │   ├── me/route.js        # Mevcut kullanıcı bilgisi
│   │       │   └── realtime/route.js  # Realtime token endpoint
│   │       ├── boards/
│   │       │   ├── route.js           # Board listele / oluştur
│   │       │   ├── join/route.js      # Odaya katılım isteği
│   │       │   └── [boardId]/
│   │       │       ├── route.js       # Board detay
│   │       │       ├── columns/       # Sütun CRUD
│   │       │       ├── cards/         # Kart CRUD
│   │       │       ├── move-card/     # Kart taşıma (RPC)
│   │       │       ├── move-column/   # Sütun taşıma
│   │       │       ├── members/       # Üye yönetimi
│   │       │       └── room-password/ # Oda şifresi sıfırlama
│   │       └── branding-bg/           # Arka plan görseli
│   ├── components/
│   │   ├── kanban-card.js             # Kart componenti (accent, drag handle)
│   │   ├── kanban-column.js           # Sütun componenti (droppable, sortable)
│   │   └── card-details-modal.js      # Kart detay/oluşturma modal
│   └── lib/
│       ├── supabase.js                # Supabase client + auth context
│       ├── session.js                 # HMAC session encode/decode
│       ├── ordering.js                # Frontend sıralama algoritması
│       ├── env.js                     # Environment değişkenleri
│       ├── api-response.js            # Standart API response helper
│       └── supabase-error.js          # Hata yönetimi
├── sql/
│   ├── 1.sql                          # Ana schema + RLS + RPC
│   ├── 2.sql                          # move_card_transactional v1
│   ├── 3.sql                          # pgcrypto search_path fix
│   ├── 5.sql                          # Checklist + start_date migration
│   ├── 6.sql                          # Board revision + Realtime
│   ├── 7.sql                          # Sütun yönetimi owner-only RLS
│   ├── 8.sql                          # Oda şifresi sıfırlama RPC
│   ├── 9.sql                          # Enum casting fix
│   ├── 10.sql                         # Üye listesi + email RPC
│   ├── 11.sql                         # Profile display_name NOT NULL
│   └── 12.sql                         # Accent color migration
```

---

## Kurulum

```bash
# Bağımlılıkları yükle
cd taskflow
npm install

# .env dosyasını yapılandır
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# SESSION_SECRET=...

# Geliştirme sunucusunu başlat
npm run dev
```

Supabase projesinde `sql/` klasöründeki dosyaları sırasıyla SQL Editor'de çalıştırarak veritabanını yapılandırın.

---

## Odaklanma Stratejisi

48 saat içinde sadece temeli yapıp bırakmadım, çok özellik ekleyip yarım da bırakmadım. **Temelin üstünde, mükemmele yakın bir seviyede** tamamlanmış bir yapı kurmayı hedefledim:

1. **Sıralama algoritması** — 3 katmanlı (Spaced Integers → Elastic Window → Global Rebalance), hem frontend hem backend'de birebir uygulandı
2. **Güvenlik** — RLS + RBAC + bcrypt ile veritabanı seviyesinde korunan oda mimarisi
3. **Sürükle-bırak** — Masaüstü ve mobilde akıcı, görsel ipuçlarıyla desteklenmiş
4. **Veri tutarlılığı** — Trigger, constraint, revision tracking, debounced persistence
5. **Gerçek zamanlı** — Supabase Realtime ile multi-user sync
6. **Ekstra özellikler** — Checklist, accent renk, sütun sıralama, oda şifresi sıfırlama, aktivite logları

> *Jules Payot'un İrade Eğitimi kitabında Pierre Nicole, çok fazla işle meşgul olup hiçbirini tam halletmeyen çalışanlara "sinek zihinliler" adını verir. François Fénelon'un güzel imgesiyle ifade edecek olursak, onlar rüzgâra açık bir yerde yanan mum gibidirler.* — Bu projede "çok özellik ama yarım mı, az özellik ama öz mü" kriterini görünce bu sözler aklıma geldi, eklemek istedim.
