import type { LegalPack } from './types.js';
import {
  LEGAL_COMPANY,
  LEGAL_EMAIL,
  LEGAL_LICENSE,
  LEGAL_PRODUCT,
  LEGAL_SITE,
  LEGAL_UPDATED,
} from './types.js';

export const LEGAL_ZH_HK: LegalPack = {
  index: {
    id: 'index',
    title: '法律文件',
    summary: `${LEGAL_PRODUCT} 的法律文件：使用條款、私隱政策與免責聲明。`,
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'about',
        heading: '1. 關於本文件',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_PRODUCT} 是由 ${LEGAL_COMPANY}（香港）發布的免費開源、自行託管軟件。你將其安裝在由你控制的 Linux 主機上。${LEGAL_COMPANY} 不是多租戶託管商，亦不以雲端服務方式營運你的面板。`,
          },
          {
            kind: 'p',
            text: `原始碼以 ${LEGAL_LICENSE} 授權。本頁文件為額外使用條件、就 ${LEGAL_COMPANY} 實際收到的資料所作的私隱說明，以及保證與責任的免責聲明。文件旨在保障 ${LEGAL_COMPANY}，並誠實說明主機責任誰屬。`,
          },
        ],
      },
      {
        id: 'documents',
        heading: '2. 文件一覽',
        blocks: [
          {
            kind: 'ul',
            items: [
              '使用條款 — 如何使用本軟件、營運者義務、可接受使用、彌償及香港法律。',
              '私隱政策 — 自行託管安裝中我們不會收集什麼，以及你來信時我們如何處理資料。',
              '免責聲明 — 軟件以現況提供、沒有服務水平協議、責任限制，以及 staking 與 EXECUTE 風險。',
            ],
          },
        ],
      },
      {
        id: 'languages',
        heading: '3. 正式語言',
        blocks: [
          {
            kind: 'p',
            text: '本文件的正式語言為英文及香港書面中文。如兩者有歧義，以英文為準。其他面板語言只翻譯介面標籤，並非正式法律文本。',
          },
        ],
      },
      {
        id: 'contact',
        heading: '4. 聯絡',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} · ${LEGAL_SITE} · ${LEGAL_EMAIL}`,
          },
          {
            kind: 'p',
            text: '如有任何收費的安裝、遷移或事故處理，須另訂書面合約。本頁不標價，亦不構成已付費委聘。',
          },
        ],
      },
    ],
  },

  terms: {
    id: 'terms',
    title: '使用條款',
    summary: `安裝及營運 ${LEGAL_PRODUCT} 的條件，包括可接受使用及香港法律。`,
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'agreement',
        heading: '1. 協議',
        blocks: [
          {
            kind: 'p',
            text: `本使用條款（「本條款」）是你（「你」、「營運者」）與在香港成立的 ${LEGAL_COMPANY}（「${LEGAL_COMPANY}」、「我們」）之間具法律約束力的協議，規管你下載、安裝、設定及使用 ${LEGAL_PRODUCT}（包括網頁面板、CLI、HTTP API、說明文件及相關 npm 套件）（「本軟件」）。`,
          },
          {
            kind: 'p',
            text: '你安裝、複製、存取或使用本軟件，即表示同意本條款、私隱政策及免責聲明。如不同意，請勿安裝或使用本軟件，並卸載已安裝的副本。',
          },
          {
            kind: 'p',
            text: '若你代表機構使用本軟件，即表示你有權約束該機構，且「你」包括該機構。',
          },
        ],
      },
      {
        id: 'licence',
        heading: '2. 軟件授權與本條款',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_PRODUCT} 的原始碼按項目 LICENSE 檔所載的 ${LEGAL_LICENSE} 授權提供。該授權在遵守通知條件的前提下，准許使用、複製、修改、合併、發布、分發、再授權及／或出售本軟件副本。`,
          },
          {
            kind: 'p',
            text: `本條款是使用編譯產品、說明文件、npm 套件及營運者面板的額外條件，並不取代 ${LEGAL_LICENSE} 授權。若本條款某項規定僅就原始碼的版權許可以 ${LEGAL_LICENSE} 授權相衝突，就該版權許可以 ${LEGAL_LICENSE} 授權為準。至於其他事項 — 包括營運風險分配、可接受使用、你與我們之間的私隱，以及法律責任 — 適用本條款、私隱政策及免責聲明。`,
          },
        ],
      },
      {
        id: 'not-hosted',
        heading: '3. 並非託管服務',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_PRODUCT} 是免費開源、自行託管的軟件。你將其安裝在由你控制的 Linux 主機上。${LEGAL_COMPANY} 不以多租戶軟件即服務方式營運你的面板，不託管你的網站、電郵、檔案、資料庫或驗證者節點，亦無法存取你的主機，除非你另行授權（例如發送診斷資料或委聘收費工作）。`,
          },
          {
            kind: 'p',
            text: '機器、作業系統、網絡、TLS 憑證、備份、監察，以及你所運行服務的法律合規，均由你提供。你是該主機上各項服務的營運者及發布者。',
          },
        ],
      },
      {
        id: 'honesty',
        heading: '4. 主機變更的誠實原則',
        blocks: [
          {
            kind: 'p',
            text: '本軟件的設計是：對主機作出變更通常需要超級用戶（root）權限，以及明確的執行旗標（YSK_EXECUTE=1 及／或 --execute）。預演、預覽、「已寫入」、「已阻擋」或類似結果並非成功，不得視為變更已套用。',
          },
          {
            kind: 'p',
            text: '你須理解此模型，自行決定何時啟用 execute，並承擔以 root 權限運行本軟件的後果。',
          },
        ],
      },
      {
        id: 'no-sla',
        heading: '5. 沒有服務水平協議及額外承諾',
        blocks: [
          {
            kind: 'p',
            text: '本軟件不附帶任何服務水平協議、可用率承諾、回應時限承諾或支援權利。說明文件、面板文案及公開頁面描述的是已實現的產品。',
          },
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} 不承諾本軟件中不存在的功能。社群或電郵回覆屬善意協助，並非保證，亦非對本條款的更改。`,
          },
        ],
      },
      {
        id: 'operator',
        heading: '6. 營運者責任',
        blocks: [
          {
            kind: 'p',
            text: '以下事項完全由你負責：',
          },
          {
            kind: 'ul',
            items: [
              '主機、面板帳戶、雙重驗證、API 金鑰、SSH、防火牆及網絡暴露的安全。',
              '你產生或匯入的密碼學金鑰、種子、憑證及秘密。面板為非託管。本軟件不保管 staking 金鑰或錢包種子。冷錢包金鑰不得放入面板。',
              '驗證者及 staking 操作，包括罰沒（slashing）、漏出塊、jail、不活躍懲罰、金鑰輪換、礦池參數，以及各鏈協議規則。',
              '電郵送達、DNS、PTR 紀錄、25 埠、黑名單及防濫用。',
              '主機上的內容、流量、torrent、分享及用戶（包括 BT tracker 及公開檔案分享）。',
              '備份、還原測試、保留及災難復原。',
              '適用於你的法律合規，包括出口管制、制裁、版權、資料保護、金融服務及其他受規管活動。',
              '你拉取的第三方容器映像、二進位檔及倉庫（包括 Docker Hub、GitHub Container Registry、npm 等）。',
              '啟用 execute 及以 root 運行本軟件的後果。',
            ],
          },
        ],
      },
      {
        id: 'aup',
        heading: '7. 可接受使用',
        blocks: [
          {
            kind: 'p',
            text: '你不得使用本軟件從事以下行為：',
          },
          {
            kind: 'ul',
            items: [
              '實施、協助或隱瞞犯罪、欺詐、無牌匯款、規避制裁，或對他人發動攻擊。',
              '分發惡意軟件或營運僵尸網絡。',
              '侵犯知識產權或私隱權。',
              '探測、干擾或超載你並不擁有或未經許可使用的系統，明示授權者除外。',
              `使人誤以為 ${LEGAL_COMPANY} 營運、背書、認證或託管你的服務。`,
            ],
          },
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} 不是你的互聯網服務供應商、託管商或內容審核者。你的機器上運行的一切，完全由你負責。`,
          },
        ],
      },
      {
        id: 'third-party',
        heading: '8. 第三方軟件',
        blocks: [
          {
            kind: 'p',
            text: `本軟件可能下載、設定或編排第三方程式（例如 nginx、Docker、PM2、WireGuard、郵件堆疊元件及區塊鏈節點映像）。該等程式由其作者授權。${LEGAL_COMPANY} 不對其缺陷、授權條款、安全公告或不相容變更負責。上游標籤與映像可在無事先通知下變更。`,
          },
        ],
      },
      {
        id: 'paid-work',
        heading: '9. YSK Limited 的收費工作',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} 可另行提供商業服務，例如安裝、遷移、加固或事故處理。該等服務僅受你與 ${LEGAL_COMPANY} 之間的書面協議或工作說明書規管。本條款、面板 Support 頁及 ${LEGAL_SITE} 不標價，亦不構成已付費委聘。`,
          },
        ],
      },
      {
        id: 'ip',
        heading: '10. 知識產權',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} 及其授權人保留 ${LEGAL_LICENSE} 授權未授予的本軟件一切權利。「YSK」、「${LEGAL_PRODUCT}」及相關名稱為 ${LEGAL_COMPANY} 的識別標記。你可以說明自己使用 ${LEGAL_PRODUCT}。未經事先書面許可，不得使人以為存在合夥、認證，或 ${LEGAL_COMPANY} 正在營運你的主機。`,
          },
        ],
      },
      {
        id: 'indemnity',
        heading: '11. 彌償',
        blocks: [
          {
            kind: 'p',
            text: `因以下事項引起的申索、損失、損害及合理法律費用，你須彌償、抗辯並使 ${LEGAL_COMPANY} 及其董事、高級人員、僱員及承辦商免受損害：(a) 你使用或濫用本軟件；(b) 你主機上的內容、流量、電郵、檔案或驗證者操作；(c) 你違反本條款或法律；或 (d) 你的用戶、客戶或交易對手提出的申索。我們可自行選聘律師參與抗辯。`,
          },
        ],
      },
      {
        id: 'changes',
        heading: '12. 修訂',
        blocks: [
          {
            kind: 'p',
            text: '我們可在公開倉庫及面板發布新版本以更新本條款。「最後更新日期」將隨之變更。你在該日期之後繼續使用本軟件，即視為接受更新。如不同意，請卸載本軟件並停止使用。',
          },
        ],
      },
      {
        id: 'termination',
        heading: '13. 終止',
        blocks: [
          {
            kind: 'p',
            text: '你可隨時停止使用本軟件（見項目的卸載說明）。依性質應繼續有效的條文 — 包括營運者責任、可接受使用、彌償、責任限制、準據法及語言 — 於終止或卸載後仍然有效。',
          },
        ],
      },
      {
        id: 'law',
        heading: '14. 準據法及法院',
        blocks: [
          {
            kind: 'p',
            text: `本條款受中華人民共和國香港特別行政區法律管轄，不適用衝突法規則。香港法院具有專屬司法管轄權，但 ${LEGAL_COMPANY} 可在任何司法管轄區尋求禁制令或同等濟助，以保障其權利或本軟件。`,
          },
        ],
      },
      {
        id: 'language',
        heading: '15. 語言',
        blocks: [
          {
            kind: 'p',
            text: '本條款以英文及香港書面中文擬備，兩者均為正式文本。如有歧義，以英文為準。',
          },
        ],
      },
      {
        id: 'general',
        heading: '16. 一般條款',
        blocks: [
          {
            kind: 'p',
            text: `若任何條文被裁定不能執行，其餘條文仍然有效。未執行某條文不構成棄權。未經我們事先書面同意，你不得轉讓本條款；我們可將本條款轉讓予關聯公司或承繼人。本條款、${LEGAL_LICENSE} 授權、私隱政策及免責聲明，構成你與 ${LEGAL_COMPANY} 就免費軟件使用的完整協議。向 ${LEGAL_COMPANY} 發出通知：${LEGAL_EMAIL}。`,
          },
        ],
      },
    ],
  },

  privacy: {
    id: 'privacy',
    title: '私隱政策',
    summary: `${LEGAL_COMPANY} 如何處理自行託管產品的個人資料 — 以及我們不會收集什麼。`,
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'who',
        heading: '1. 我們是誰',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_COMPANY}（香港）發布 ${LEGAL_PRODUCT}。聯絡：${LEGAL_EMAIL} · ${LEGAL_SITE}`,
          },
          {
            kind: 'p',
            text: `本政策說明 ${LEGAL_COMPANY} 如何處理個人資料，並以香港法例第 486 章《個人資料（私隱）條例》（「私隱條例」）為框架。${LEGAL_COMPANY} 僅就其實際收到的個人資料屬資料使用者。`,
          },
        ],
      },
      {
        id: 'self-hosted',
        heading: '2. 自行託管：我們看不到你的安裝',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_PRODUCT} 在你的機器上運行。在一般產品使用中，${LEGAL_COMPANY} 不會收到遙測、當機報告、鏈上資料、電郵、檔案、面板憑證、驗證者金鑰或你主機的內容。使用本軟件無須 ${LEGAL_COMPANY} 雲端帳戶。`,
          },
          {
            kind: 'p',
            text: '本政策不聲稱收集產品並未執行的資料。若日後版本加入可選遙測，將會載明，且預設關閉，除非你選擇加入。',
          },
        ],
      },
      {
        id: 'when',
        heading: '3. 我們何時處理個人資料',
        blocks: [
          {
            kind: 'p',
            text: '僅在你選擇向我們提供時，我們才處理個人資料，包括：',
          },
          {
            kind: 'ul',
            items: [
              `發送至 ${LEGAL_EMAIL} 的支援或錯誤電郵（姓名、電郵地址、技術事實、log 或你附上的診斷貼文）。`,
              `就 ${LEGAL_COMPANY} 收費工作提出的商務查詢。`,
              '捐款或贊助往來。本軟件不含支付處理器。GitHub Sponsors、Linktree 及鏈上捐款屬第三方服務。',
              '你在公開倉庫發布的 GitHub issue、pull request 及討論。',
            ],
          },
          {
            kind: 'p',
            text: '我們使用該等資料以回覆、改進本軟件、保存法律申索或會計所需紀錄，以及就你的請求作通訊。',
          },
        ],
      },
      {
        id: 'panel',
        heading: '4. 你面板上的資料',
        blocks: [
          {
            kind: 'p',
            text: `工作階段 cookie、語言偏好及面板使用的其他儲存，位於你所設定的來源（你的瀏覽器與你的面板通訊）。該處理屬你的處理。你是該主機的營運者，按事實可能屬私隱條例下的資料使用者，或在其他法律下屬你自身用戶的控制者。本政策並不使 ${LEGAL_COMPANY} 成為你客戶資料的控制者。`,
          },
        ],
      },
      {
        id: 'third-parties',
        heading: '5. 你選擇的第三方',
        blocks: [
          {
            kind: 'p',
            text: `若你使用 GitHub、npm、Let's Encrypt、Docker 倉庫、DNS 供應商、區塊鏈網絡或類似服務，他們收到的資料受其政策規管。${LEGAL_COMPANY} 並不控制該等服務。`,
          },
        ],
      },
      {
        id: 'no-sale',
        heading: '6. 不出售個人資料',
        blocks: [
          {
            kind: 'p',
            text: '我們不出售個人資料。',
          },
        ],
      },
      {
        id: 'retention',
        heading: '7. 保留',
        blocks: [
          {
            kind: 'p',
            text: '支援及查詢電郵在處理請求、保存安全或濫用紀錄，以及履行法律責任所需期間內保留，其後刪除或以限制存取方式封存。公開 GitHub 內容按 GitHub 條款留在 GitHub。',
          },
        ],
      },
      {
        id: 'pdpo',
        heading: '8. 查閱及改正（私隱條例）',
        blocks: [
          {
            kind: 'p',
            text: `若我們持有你的個人資料，你可按私隱條例請求查閱及改正。請電郵 ${LEGAL_EMAIL}。我們或須核實你的身分。我們不設歐盟代表，不就我們無法看見的自行託管產品聲稱 GDPR 資料可攜流程，亦不在「我們不出售個人資料」的事實以外，聲稱具備 CCPA「請勿出售」機制。`,
          },
        ],
      },
      {
        id: 'security',
        heading: '9. 你發送資料的安全',
        blocks: [
          {
            kind: 'p',
            text: '我們對收到的支援電郵採取合理措施。任何電郵途徑均非絕對安全。請勿以電郵發送冷錢包金鑰、種子短語或生產環境密碼。',
          },
        ],
      },
      {
        id: 'children',
        heading: '10. 兒童',
        blocks: [
          {
            kind: 'p',
            text: '本軟件面向 Linux 伺服器營運者，並非面向兒童。我們不會明知而向兒童索取個人資料。',
          },
        ],
      },
      {
        id: 'overseas',
        heading: '11. 跨境轉移',
        blocks: [
          {
            kind: 'p',
            text: '電郵及 GitHub 可能在香港以外儲存或處理資料。你經該等渠道聯絡我們，即表示理解此事。',
          },
        ],
      },
      {
        id: 'changes',
        heading: '12. 修訂',
        blocks: [
          {
            kind: 'p',
            text: '我們可在倉庫及面板更新本政策。「最後更新日期」將隨之變更。你在該日期之後繼續使用本軟件，即視為接受更新後的政策，適用於我們其後處理的資料。',
          },
        ],
      },
      {
        id: 'language',
        heading: '13. 語言',
        blocks: [
          {
            kind: 'p',
            text: '本政策以英文及香港書面中文擬備，兩者均為正式文本。如有歧義，以英文為準。',
          },
        ],
      },
    ],
  },

  disclaimer: {
    id: 'disclaimer',
    title: '免責聲明',
    summary: '不提供保證、沒有服務水平協議，以及責任限制 — 包括 staking、電郵、備份及 EXECUTE。',
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'as-is',
        heading: '1. 「現況」及「現供」',
        blocks: [
          {
            kind: 'p',
            tone: 'warranty',
            text: '本軟件按「現況」及「現供」提供，不附帶任何明示或默示保證，包括但不限於適銷性、特定用途適用性、所有權及不侵權保證。',
          },
          {
            kind: 'p',
            text: `此陳述與 ${LEGAL_LICENSE} 授權一致，並在此向編譯產品的營運者重申。面板、README 或 Support 頁的任何內容，均不構成保證、對未來表現的陳述，或專業意見（法律、財務、稅務或投資）。`,
          },
          {
            kind: 'p',
            text: `在香港法律允許的最大範圍內，${LEGAL_COMPANY} 免除法律容許免除的一切保證及條件。`,
          },
        ],
      },
      {
        id: 'risks',
        heading: '2. 營運者風險',
        blocks: [
          {
            kind: 'p',
            text: `你使用本軟件須自行承擔風險。在不限制前述原則下，${LEGAL_COMPANY} 不就以下事項負責：`,
          },
          {
            kind: 'ul',
            items: [
              '資料遺失、靜默損壞或備份失敗。',
              '停機、網絡隔離或防火牆設定錯誤。',
              '安全事故、憑證被盜或未經授權的 execute。',
              '電郵未能送達、被列入黑名單或被判定為垃圾郵件。',
              '驗證者罰沒、漏出塊、jail、金鑰外洩或協議懲罰。',
              'Docker、上游映像、PM2、WireGuard、nginx 或其他第三方軟件的缺陷或不相容變更。',
              '將預演或已阻擋的套用視為成功而引致的損失。',
              '運行節點、電郵、檔案分享或任何其他服務所生的監管、稅務或牌照後果。',
            ],
          },
        ],
      },
      {
        id: 'limitation',
        heading: '3. 責任限制',
        blocks: [
          {
            kind: 'p',
            text: `在香港法律允許的最大範圍內，${LEGAL_COMPANY} 及其董事、高級人員、僱員及承辦商，不論基於合約、侵權（包括疏忽）、成文法或其他，均不就任何間接、附帶、特別、相應而生、懲罰性或懲戒性損害，或利潤、收益、資料、商譽或業務中斷損失負責，即使已獲告知有發生可能。`,
          },
          {
            kind: 'p',
            text: `就免費軟件而言，在法律允許的最大範圍內排除 ${LEGAL_COMPANY} 的全部累計責任。若不能完全排除，則限於香港法律不容許排除的最低金額。`,
          },
          {
            kind: 'p',
            text: `就 ${LEGAL_COMPANY} 根據另行書面協議提供的收費服務，除非該協議另有規定，${LEGAL_COMPANY} 就該項委聘的全部累計責任，以你就該項委聘實際支付予 ${LEGAL_COMPANY} 的費用為限。`,
          },
          {
            kind: 'p',
            text: '本文件並不排除或限制因疏忽造成死亡或人身傷害、欺詐或欺詐失實陳述的責任，或香港法律不容許排除或限制的任何其他責任，包括在《管制免責條款條例》（第 71 章）或《不合情理合約條例》（第 458 章）適用的情況。',
          },
        ],
      },
      {
        id: 'third-party',
        heading: '4. 第三方及開源元件',
        blocks: [
          {
            kind: 'p',
            text: `開源及第三方元件由其作者按其自身條款提供，通常亦為「現況」提供。${LEGAL_COMPANY} 不是該等元件的保證人。`,
          },
        ],
      },
      {
        id: 'beta',
        heading: '5. Beta 功能',
        blocks: [
          {
            kind: 'p',
            text: '標示為 Beta 的功能（包括第一層驗證者編排）可能變更、故障或被移除。它們不是 staking 服務、託管服務或礦池即服務。金鑰、協議義務及財務損失仍完全由你負責。',
          },
        ],
      },
      {
        id: 'language',
        heading: '6. 語言及法律',
        blocks: [
          {
            kind: 'p',
            text: `本免責聲明受香港特別行政區法律管轄。正式語言為英文及香港書面中文。如有歧義，以英文為準。聯絡：${LEGAL_EMAIL}。`,
          },
        ],
      },
    ],
  },
};
