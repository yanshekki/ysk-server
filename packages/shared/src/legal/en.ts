import type { LegalPack } from './types.js';
import {
  LEGAL_COMPANY,
  LEGAL_EMAIL,
  LEGAL_LICENSE,
  LEGAL_PRODUCT,
  LEGAL_SITE,
  LEGAL_UPDATED,
} from './types.js';

export const LEGAL_EN: LegalPack = {
  index: {
    id: 'index',
    title: 'Legal',
    summary: `Legal documents for ${LEGAL_PRODUCT}: Terms of Use, Privacy Policy, and Disclaimer.`,
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'about',
        heading: '1. About these documents',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_PRODUCT} is free, open-source, self-hosted software published by ${LEGAL_COMPANY} (Hong Kong). You install it on a Linux host that you control. ${LEGAL_COMPANY} is not a multi-tenant hosting provider and does not operate your panel as a cloud service.`,
          },
          {
            kind: 'p',
            text: `The source code is licensed under the ${LEGAL_LICENSE} License. The documents on this page are additional conditions of use, a description of privacy for data ${LEGAL_COMPANY} actually receives, and a disclaimer of warranty and liability. They protect ${LEGAL_COMPANY} and tell you, honestly, who is responsible for the machine.`,
          },
        ],
      },
      {
        id: 'documents',
        heading: '2. Documents',
        blocks: [
          {
            kind: 'ul',
            items: [
              'Terms of Use — how you may use the software, operator duties, acceptable use, indemnity, and Hong Kong law.',
              'Privacy Policy — what we do not collect from a self-hosted install, and what we process if you email us.',
              'Disclaimer — AS IS software, no SLA, limitation of liability, staking and EXECUTE risks.',
            ],
          },
        ],
      },
      {
        id: 'languages',
        heading: '3. Official languages',
        blocks: [
          {
            kind: 'p',
            text: 'The official languages of these documents are English and Hong Kong written Chinese. If the two texts differ, the English version controls. Other panel languages translate labels only; they are not official legal text.',
          },
        ],
      },
      {
        id: 'contact',
        heading: '4. Contact',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} · ${LEGAL_SITE} · ${LEGAL_EMAIL}`,
          },
          {
            kind: 'p',
            text: `Paid setup, migration, or incident work (if any) is a separate written contract. These pages do not quote prices and do not form a paid engagement.`,
          },
        ],
      },
    ],
  },

  terms: {
    id: 'terms',
    title: 'Terms of Use',
    summary: `Conditions for installing and operating ${LEGAL_PRODUCT}, including acceptable use and Hong Kong law.`,
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'agreement',
        heading: '1. Agreement',
        blocks: [
          {
            kind: 'p',
            text: `These Terms of Use (“Terms”) are a legally binding agreement between you (“you”, “operator”) and ${LEGAL_COMPANY}, a company incorporated in Hong Kong (“${LEGAL_COMPANY}”, “we”, “us”), governing your download, installation, configuration, and use of ${LEGAL_PRODUCT} (the web panel, CLI, HTTP API, documentation, and related npm packages) (the “Software”).`,
          },
          {
            kind: 'p',
            text: 'By installing, copying, accessing, or using the Software, you agree to these Terms, the Privacy Policy, and the Disclaimer. If you do not agree, do not install or use the Software, and uninstall any copy you have.',
          },
          {
            kind: 'p',
            text: 'If you use the Software on behalf of an organisation, you represent that you have authority to bind that organisation, and “you” includes that organisation.',
          },
        ],
      },
      {
        id: 'licence',
        heading: '2. Software licence and these Terms',
        blocks: [
          {
            kind: 'p',
            text: `The source code of ${LEGAL_PRODUCT} is made available under the ${LEGAL_LICENSE} License as published in the project LICENSE file. That licence grants copyright permission to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to its notice conditions.`,
          },
          {
            kind: 'p',
            text: `These Terms are additional conditions of using the compiled product, documentation, npm packages, and operator panel. They do not replace the ${LEGAL_LICENSE} License. If a provision of these Terms conflicts with the ${LEGAL_LICENSE} License solely as to copyright permission for the source, the ${LEGAL_LICENSE} License controls that copyright permission. For all other matters — including allocation of operational risk, acceptable use, privacy as between you and us, and liability — these Terms, the Privacy Policy, and the Disclaimer apply.`,
          },
        ],
      },
      {
        id: 'not-hosted',
        heading: '3. Not a hosted service',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_PRODUCT} is free, open-source, self-hosted software. You install it on a Linux host that you control. ${LEGAL_COMPANY} does not operate your panel as multi-tenant software-as-a-service, does not host your sites, mail, files, databases, or validator nodes, and does not have access to your host unless you separately grant access (for example by sending diagnostic material or contracting paid work).`,
          },
          {
            kind: 'p',
            text: 'You supply the machine, operating system, network, TLS certificates, backups, monitoring, and legal compliance for whatever you run. You are the operator and publisher of services on that host.',
          },
        ],
      },
      {
        id: 'honesty',
        heading: '4. Honesty of host changes',
        blocks: [
          {
            kind: 'p',
            text: 'The Software is designed so that mutations to the host typically require superuser (root) privileges and an explicit execute flag (YSK_EXECUTE=1 and/or --execute). A dry-run, preview, “written”, “blocked”, or similar result is not success and must not be treated as an applied change.',
          },
          {
            kind: 'p',
            text: 'You are responsible for understanding this model, for deciding when to enable execute, and for the consequences of running the Software with root privileges.',
          },
        ],
      },
      {
        id: 'no-sla',
        heading: '5. No SLA and no extra promises',
        blocks: [
          {
            kind: 'p',
            text: 'The Software is provided without any service-level agreement, uptime commitment, response-time commitment, or support entitlement. Documentation, panel copy, and public pages describe the product as implemented.',
          },
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} does not promise features that are not in the Software. Community or email replies are goodwill, not a warranty and not a variation of these Terms.`,
          },
        ],
      },
      {
        id: 'operator',
        heading: '6. Operator responsibilities',
        blocks: [
          {
            kind: 'p',
            text: 'You are solely responsible for:',
          },
          {
            kind: 'ul',
            items: [
              'Securing the host, panel accounts, two-factor authentication, API keys, SSH, firewall, and network exposure.',
              'Cryptographic keys, seeds, certificates, and secrets you generate or import. The panel is non-custodial. The Software does not take custody of staking keys or wallet seeds. Cold keys must not be placed in the panel.',
              'Validator and staking operations, including slashing, missed blocks, jail, inactivity penalties, key rotation, pool parameters, and each chain’s protocol rules.',
              'Mail deliverability, DNS, PTR records, port 25, blacklists, and anti-abuse.',
              'Content, traffic, torrents, shares, and users on your host (including the BT tracker and public file shares).',
              'Backups, restore tests, retention, and disaster recovery.',
              'Compliance with laws that apply to you, including export, sanctions, copyright, data protection, financial services, and other regulated activity.',
              'Third-party container images, binaries, and registries you pull (including Docker Hub, GitHub Container Registry, npm, and similar).',
              'Consequences of enabling execute and running the Software as root.',
            ],
          },
        ],
      },
      {
        id: 'aup',
        heading: '7. Acceptable use',
        blocks: [
          {
            kind: 'p',
            text: 'You must not use the Software to:',
          },
          {
            kind: 'ul',
            items: [
              'Commit, facilitate, or conceal crime, fraud, unlicensed money transmission, sanctions evasion, or attacks on others.',
              'Distribute malware or operate botnets.',
              'Infringe intellectual property or privacy rights.',
              'Probe, disrupt, or overload systems you do not own or lack permission to use, except as expressly authorised.',
              `Misrepresent that ${LEGAL_COMPANY} operates, endorses, certifies, or hosts your service.`,
            ],
          },
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} is not your internet service provider, hosting provider, or content moderator. You are solely accountable for what runs on your machine.`,
          },
        ],
      },
      {
        id: 'third-party',
        heading: '8. Third-party software',
        blocks: [
          {
            kind: 'p',
            text: `The Software may download, configure, or orchestrate third-party programs (for example nginx, Docker, PM2, WireGuard, mail-stack components, and blockchain node images). Those programs are licensed by their authors. ${LEGAL_COMPANY} is not responsible for their defects, licence terms, security advisories, or breaking changes. Upstream tags and images can change without notice.`,
          },
        ],
      },
      {
        id: 'paid-work',
        heading: '9. Paid work by YSK Limited',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} may offer separate commercial services such as setup, migration, hardening, or incident response. Those services are governed only by a written agreement or statement of work between you and ${LEGAL_COMPANY}. These Terms, the panel Support page, and ${LEGAL_SITE} do not quote prices and do not form a paid engagement.`,
          },
        ],
      },
      {
        id: 'ip',
        heading: '10. Intellectual property',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} and its licensors retain all rights in the Software not granted by the ${LEGAL_LICENSE} License. “YSK”, “${LEGAL_PRODUCT}”, and related names are identifiers of ${LEGAL_COMPANY}. You may state that you use ${LEGAL_PRODUCT}. You may not suggest partnership, certification, or that ${LEGAL_COMPANY} operates your host without prior written permission.`,
          },
        ],
      },
      {
        id: 'indemnity',
        heading: '11. Indemnity',
        blocks: [
          {
            kind: 'p',
            text: `You shall indemnify, defend, and hold harmless ${LEGAL_COMPANY} and its directors, officers, employees, and contractors from and against claims, losses, damages, and reasonable legal costs arising out of: (a) your use or misuse of the Software; (b) content, traffic, mail, files, or validator operations on your host; (c) your breach of these Terms or of law; or (d) claims by your users, customers, or counterparties. We may participate in the defence with counsel of our choice.`,
          },
        ],
      },
      {
        id: 'changes',
        heading: '12. Changes',
        blocks: [
          {
            kind: 'p',
            text: 'We may update these Terms by publishing a new version in the public repository and in the panel. The “Last updated” date will change. Continued use of the Software after that date constitutes acceptance. If you do not agree, uninstall the Software and stop using it.',
          },
        ],
      },
      {
        id: 'termination',
        heading: '13. Termination',
        blocks: [
          {
            kind: 'p',
            text: 'You may stop using the Software at any time (see the project’s uninstall documentation). Sections that by their nature should survive — including operator responsibilities, acceptable use, indemnity, limitation of liability, governing law, and language — survive termination or uninstall.',
          },
        ],
      },
      {
        id: 'law',
        heading: '14. Governing law and courts',
        blocks: [
          {
            kind: 'p',
            text: `These Terms are governed by the laws of the Hong Kong Special Administrative Region of the People’s Republic of China, without regard to conflict-of-law rules. The courts of Hong Kong have exclusive jurisdiction, except that ${LEGAL_COMPANY} may seek injunctive or equivalent relief in any forum to protect its rights or the Software.`,
          },
        ],
      },
      {
        id: 'language',
        heading: '15. Language',
        blocks: [
          {
            kind: 'p',
            text: 'These Terms are prepared in English and in Hong Kong written Chinese. Both are official. If they differ, the English version controls.',
          },
        ],
      },
      {
        id: 'general',
        heading: '16. General',
        blocks: [
          {
            kind: 'p',
            text: `If a provision is held unenforceable, the remainder continues in effect. Failure to enforce a provision is not a waiver. You may not assign these Terms without our prior written consent; we may assign them to an affiliate or successor. These Terms, the ${LEGAL_LICENSE} License, the Privacy Policy, and the Disclaimer are the entire agreement between you and ${LEGAL_COMPANY} for use of the free Software. Notices to ${LEGAL_COMPANY}: ${LEGAL_EMAIL}.`,
          },
        ],
      },
    ],
  },

  privacy: {
    id: 'privacy',
    title: 'Privacy Policy',
    summary: `How ${LEGAL_COMPANY} handles personal data for a self-hosted product — and what we do not collect.`,
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'who',
        heading: '1. Who we are',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_COMPANY} (Hong Kong) publishes ${LEGAL_PRODUCT}. Contact: ${LEGAL_EMAIL} · ${LEGAL_SITE}`,
          },
          {
            kind: 'p',
            text: `This Policy describes how ${LEGAL_COMPANY} handles personal data. It is framed for the Personal Data (Privacy) Ordinance (Cap. 486) of Hong Kong (“PDPO”). ${LEGAL_COMPANY} is a data user only for personal data it actually receives.`,
          },
        ],
      },
      {
        id: 'self-hosted',
        heading: '2. Self-hosted: we do not see your install',
        blocks: [
          {
            kind: 'p',
            text: `${LEGAL_PRODUCT} runs on your machine. In the ordinary product, ${LEGAL_COMPANY} does not receive telemetry, crash reports, chain data, mail, files, panel credentials, validator keys, or the contents of your host. You do not need a ${LEGAL_COMPANY} cloud account to use the Software.`,
          },
          {
            kind: 'p',
            text: 'This Policy does not claim collection that the product does not perform. If a future version adds optional telemetry, it will be documented and off unless you opt in.',
          },
        ],
      },
      {
        id: 'when',
        heading: '3. When we process personal data',
        blocks: [
          {
            kind: 'p',
            text: 'We process personal data only when you choose to give it to us, including:',
          },
          {
            kind: 'ul',
            items: [
              `Support or bug emails to ${LEGAL_EMAIL} (name, email address, technical facts, logs, or diagnostic paste you attach).`,
              `Commercial enquiries for paid ${LEGAL_COMPANY} work.`,
              'Donation or sponsorship correspondence. The Software does not contain a payment processor. GitHub Sponsors, Linktree, and on-chain donations are third-party services.',
              'GitHub issues, pull requests, and discussions you post on the public repository.',
            ],
          },
          {
            kind: 'p',
            text: 'We use this data to respond, to improve the Software, to keep records we need for legal claims or accounting, and to communicate about your request.',
          },
        ],
      },
      {
        id: 'panel',
        heading: '4. Data on your panel',
        blocks: [
          {
            kind: 'p',
            text: `Session cookies, locale preference, and other storage used by the panel live on the origin you configured (your browser talking to your panel). That processing is yours. You are the operator of that host and, depending on your facts, may be a data user under the PDPO or a controller under other laws for your own users. This Policy does not make ${LEGAL_COMPANY} the controller of your customers' data.`,
          },
        ],
      },
      {
        id: 'third-parties',
        heading: '5. Third parties you choose',
        blocks: [
          {
            kind: 'p',
            text: `If you use GitHub, npm, Let's Encrypt, Docker registries, DNS providers, blockchain networks, or similar, their policies apply to data they receive. ${LEGAL_COMPANY} does not control those services.`,
          },
        ],
      },
      {
        id: 'no-sale',
        heading: '6. No sale of personal data',
        blocks: [
          {
            kind: 'p',
            text: 'We do not sell personal data.',
          },
        ],
      },
      {
        id: 'retention',
        heading: '7. Retention',
        blocks: [
          {
            kind: 'p',
            text: 'Support and enquiry mail is kept as long as needed to handle the request, maintain a security or abuse record, and meet legal duties, then deleted or archived with restricted access. Public GitHub content remains on GitHub under GitHub’s terms.',
          },
        ],
      },
      {
        id: 'pdpo',
        heading: '8. Access and correction (PDPO)',
        blocks: [
          {
            kind: 'p',
            text: `If we hold your personal data, you may request access and correction as provided by the PDPO. Email ${LEGAL_EMAIL}. We may need to verify your identity. We do not operate an EU representative, do not claim GDPR portability workflows for a self-hosted product we cannot see, and do not claim CCPA “do not sell” mechanisms beyond the fact that we do not sell personal data.`,
          },
        ],
      },
      {
        id: 'security',
        heading: '9. Security of what you send us',
        blocks: [
          {
            kind: 'p',
            text: 'We apply reasonable measures to support mail we receive. No email path is perfectly secure. Do not send cold keys, seed phrases, or production passwords by email.',
          },
        ],
      },
      {
        id: 'children',
        heading: '10. Children',
        blocks: [
          {
            kind: 'p',
            text: 'The Software is directed at operators of Linux servers, not children. We do not knowingly solicit personal data from children.',
          },
        ],
      },
      {
        id: 'overseas',
        heading: '11. Overseas transfer',
        blocks: [
          {
            kind: 'p',
            text: 'Email and GitHub may store or process data outside Hong Kong. By contacting us through those channels you understand that.',
          },
        ],
      },
      {
        id: 'changes',
        heading: '12. Changes',
        blocks: [
          {
            kind: 'p',
            text: 'We may update this Policy in the repository and in the panel. The “Last updated” date will change. Continued use of the Software after that date constitutes acceptance of the updated Policy for data we subsequently process.',
          },
        ],
      },
      {
        id: 'language',
        heading: '13. Language',
        blocks: [
          {
            kind: 'p',
            text: 'This Policy is prepared in English and in Hong Kong written Chinese. Both are official. If they differ, the English version controls.',
          },
        ],
      },
    ],
  },

  disclaimer: {
    id: 'disclaimer',
    title: 'Disclaimer',
    summary: 'No warranty, no SLA, and limits on liability — including staking, mail, backups, and EXECUTE.',
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'as-is',
        heading: '1. AS IS and AS AVAILABLE',
        blocks: [
          {
            kind: 'p',
            tone: 'warranty',
            text: `THE SOFTWARE IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.`,
          },
          {
            kind: 'p',
            text: `This statement is consistent with the ${LEGAL_LICENSE} License and is repeated here for operators of the compiled product. Nothing in the panel, README, or Support page is a warranty, a representation of future performance, or professional advice (legal, financial, tax, or investment).`,
          },
          {
            kind: 'p',
            text: `To the maximum extent permitted by the laws of Hong Kong, ${LEGAL_COMPANY} disclaims all warranties and conditions that the law allows to be excluded.`,
          },
        ],
      },
      {
        id: 'risks',
        heading: '2. Operator risk',
        blocks: [
          {
            kind: 'p',
            text: `You use the Software at your own risk. Without limitation, ${LEGAL_COMPANY} is not liable for:`,
          },
          {
            kind: 'ul',
            items: [
              'Data loss, silent corruption, or backup failure.',
              'Downtime, network isolation, or firewall misconfiguration.',
              'Security incidents, credential theft, or unauthorised execute.',
              'Mail non-delivery, blacklisting, or spam classification.',
              'Validator slashing, missed blocks, jail, leaked keys, or protocol penalties.',
              'Defects or breaking changes in Docker, upstream images, PM2, WireGuard, nginx, or other third-party software.',
              'Loss from treating a dry-run or blocked apply as success.',
              'Regulatory, tax, or licensing consequences of running nodes, mail, file sharing, or any other service.',
            ],
          },
        ],
      },
      {
        id: 'limitation',
        heading: '3. Limitation of liability',
        blocks: [
          {
            kind: 'p',
            text: `To the maximum extent permitted by Hong Kong law, ${LEGAL_COMPANY} and its directors, officers, employees, and contractors shall not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, revenue, data, goodwill, or business interruption, whether in contract, tort (including negligence), statute, or otherwise, even if advised of the possibility.`,
          },
          {
            kind: 'p',
            text: `For the free Software, ${LEGAL_COMPANY}’s total aggregate liability is excluded to the fullest extent permitted. Where a complete exclusion is not permitted, liability is limited to the minimum amount that Hong Kong law does not allow to be excluded.`,
          },
          {
            kind: 'p',
            text: `For paid services supplied by ${LEGAL_COMPANY} under a separate written agreement, unless that agreement says otherwise, ${LEGAL_COMPANY}’s total aggregate liability for that engagement is limited to the fees actually paid to ${LEGAL_COMPANY} for that engagement.`,
          },
          {
            kind: 'p',
            text: 'Nothing in these documents excludes or limits liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for any other liability that cannot be excluded or limited under Hong Kong law, including where the Control of Exemption Clauses Ordinance (Cap. 71) or the Unconscionable Contracts Ordinance (Cap. 458) applies.',
          },
        ],
      },
      {
        id: 'third-party',
        heading: '4. Third-party and open-source components',
        blocks: [
          {
            kind: 'p',
            text: `Open-source and third-party components are provided by their authors on their own terms, typically also “as is”. ${LEGAL_COMPANY} is not the warrantor of those components.`,
          },
        ],
      },
      {
        id: 'beta',
        heading: '5. Beta features',
        blocks: [
          {
            kind: 'p',
            text: 'Features marked Beta (including L1 validator orchestration) may change, break, or be removed. They are not a staking service, custody service, or pool-as-a-service. You remain solely responsible for keys, protocol duties, and financial loss.',
          },
        ],
      },
      {
        id: 'language',
        heading: '6. Language and law',
        blocks: [
          {
            kind: 'p',
            text: `This Disclaimer is governed by the laws of the Hong Kong Special Administrative Region. Official languages: English and Hong Kong written Chinese. If they differ, the English version controls. Contact: ${LEGAL_EMAIL}.`,
          },
        ],
      },
    ],
  },
};
