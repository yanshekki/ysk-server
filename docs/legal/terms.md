# Terms of Use

> Language: English | [中文](./terms-ZH.md)

**YSK Limited** · 20 August 2026

Official languages: English and Hong Kong written Chinese. If they differ, **English controls**.

Contact: [email@ysk.hk](mailto:email@ysk.hk) · [https://ysk.hk/](https://ysk.hk/)

## 1. Agreement

These Terms of Use (“Terms”) are a legally binding agreement between you (“you”, “operator”) and YSK Limited, a company incorporated in Hong Kong (“YSK Limited”, “we”, “us”), governing your download, installation, configuration, and use of YSK Server (the web panel, CLI, HTTP API, documentation, and related npm packages) (the “Software”).

By installing, copying, accessing, or using the Software, you agree to these Terms, the Privacy Policy, and the Disclaimer. If you do not agree, do not install or use the Software, and uninstall any copy you have.

If you use the Software on behalf of an organisation, you represent that you have authority to bind that organisation, and “you” includes that organisation.

## 2. Software licence and these Terms

The source code of YSK Server is made available under the MIT License as published in the project LICENSE file. That licence grants copyright permission to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to its notice conditions.

These Terms are additional conditions of using the compiled product, documentation, npm packages, and operator panel. They do not replace the MIT License. If a provision of these Terms conflicts with the MIT License solely as to copyright permission for the source, the MIT License controls that copyright permission. For all other matters — including allocation of operational risk, acceptable use, privacy as between you and us, and liability — these Terms, the Privacy Policy, and the Disclaimer apply.

## 3. Not a hosted service

YSK Server is free, open-source, self-hosted software. You install it on a Linux host that you control. YSK Limited does not operate your panel as multi-tenant software-as-a-service, does not host your sites, mail, files, databases, or validator nodes, and does not have access to your host unless you separately grant access (for example by sending diagnostic material or contracting paid work).

You supply the machine, operating system, network, TLS certificates, backups, monitoring, and legal compliance for whatever you run. You are the operator and publisher of services on that host.

## 4. Honesty of host changes

The Software is designed so that mutations to the host typically require superuser (root) privileges and an explicit execute flag (YSK_EXECUTE=1 and/or --execute). A dry-run, preview, “written”, “blocked”, or similar result is not success and must not be treated as an applied change.

You are responsible for understanding this model, for deciding when to enable execute, and for the consequences of running the Software with root privileges.

## 5. No SLA and no extra promises

The Software is provided without any service-level agreement, uptime commitment, response-time commitment, or support entitlement. Documentation, panel copy, and public pages describe the product as implemented.

YSK Limited does not promise features that are not in the Software. Community or email replies are goodwill, not a warranty and not a variation of these Terms.

## 6. Operator responsibilities

You are solely responsible for:

- Securing the host, panel accounts, two-factor authentication, API keys, SSH, firewall, and network exposure.
- Cryptographic keys, seeds, certificates, and secrets you generate or import. The panel is non-custodial. The Software does not take custody of staking keys or wallet seeds. Cold keys must not be placed in the panel.
- Validator and staking operations, including slashing, missed blocks, jail, inactivity penalties, key rotation, pool parameters, and each chain’s protocol rules.
- Mail deliverability, DNS, PTR records, port 25, blacklists, and anti-abuse.
- Content, traffic, torrents, shares, and users on your host (including the BT tracker and public file shares).
- Backups, restore tests, retention, and disaster recovery.
- Compliance with laws that apply to you, including export, sanctions, copyright, data protection, financial services, and other regulated activity.
- Third-party container images, binaries, and registries you pull (including Docker Hub, GitHub Container Registry, npm, and similar).
- Consequences of enabling execute and running the Software as root.

## 7. Acceptable use

You must not use the Software to:

- Commit, facilitate, or conceal crime, fraud, unlicensed money transmission, sanctions evasion, or attacks on others.
- Distribute malware or operate botnets.
- Infringe intellectual property or privacy rights.
- Probe, disrupt, or overload systems you do not own or lack permission to use, except as expressly authorised.
- Misrepresent that YSK Limited operates, endorses, certifies, or hosts your service.

YSK Limited is not your internet service provider, hosting provider, or content moderator. You are solely accountable for what runs on your machine.

## 8. Third-party software

The Software may download, configure, or orchestrate third-party programs (for example nginx, Docker, PM2, WireGuard, mail-stack components, and blockchain node images). Those programs are licensed by their authors. YSK Limited is not responsible for their defects, licence terms, security advisories, or breaking changes. Upstream tags and images can change without notice.

## 9. Paid work by YSK Limited

YSK Limited may offer separate commercial services such as setup, migration, hardening, or incident response. Those services are governed only by a written agreement or statement of work between you and YSK Limited. These Terms, the panel Support page, and https://ysk.hk/ do not quote prices and do not form a paid engagement.

## 10. Intellectual property

YSK Limited and its licensors retain all rights in the Software not granted by the MIT License. “YSK”, “YSK Server”, and related names are identifiers of YSK Limited. You may state that you use YSK Server. You may not suggest partnership, certification, or that YSK Limited operates your host without prior written permission.

## 11. Indemnity

You shall indemnify, defend, and hold harmless YSK Limited and its directors, officers, employees, and contractors from and against claims, losses, damages, and reasonable legal costs arising out of: (a) your use or misuse of the Software; (b) content, traffic, mail, files, or validator operations on your host; (c) your breach of these Terms or of law; or (d) claims by your users, customers, or counterparties. We may participate in the defence with counsel of our choice.

## 12. Changes

We may update these Terms by publishing a new version in the public repository and in the panel. The “Last updated” date will change. Continued use of the Software after that date constitutes acceptance. If you do not agree, uninstall the Software and stop using it.

## 13. Termination

You may stop using the Software at any time (see the project’s uninstall documentation). Sections that by their nature should survive — including operator responsibilities, acceptable use, indemnity, limitation of liability, governing law, and language — survive termination or uninstall.

## 14. Governing law and courts

These Terms are governed by the laws of the Hong Kong Special Administrative Region of the People’s Republic of China, without regard to conflict-of-law rules. The courts of Hong Kong have exclusive jurisdiction, except that YSK Limited may seek injunctive or equivalent relief in any forum to protect its rights or the Software.

## 15. Language

These Terms are prepared in English and in Hong Kong written Chinese. Both are official. If they differ, the English version controls.

## 16. General

If a provision is held unenforceable, the remainder continues in effect. Failure to enforce a provision is not a waiver. You may not assign these Terms without our prior written consent; we may assign them to an affiliate or successor. These Terms, the MIT License, the Privacy Policy, and the Disclaimer are the entire agreement between you and YSK Limited for use of the free Software. Notices to YSK Limited: email@ysk.hk.
