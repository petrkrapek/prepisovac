# Návod: Automatický přepis nahrávek do textu

Tato stránka popisuje, jak funguje automatický přepis audio a video nahrávek uložených na Google Disku a jak s ním pracovat jako běžný uživatel. Technická dokumentace pro správce je v souboru README u zdrojového kódu skriptu.

## K čemu služba slouží

Nahrávky (porady, diktáty, rozhovory) vložené do určené složky na Google Disku se automaticky přepíší do textu. Přepis probíhá dvěma nezávislými rozpoznávači řeči současně a umělá inteligence z obou verzí sestaví jeden výsledný text — opraví překlepy, doplní interpunkci a rozdělí text do odstavců. Dva rozpoznávače se používají proto, že každý dělá jiné typy chyb; porovnáním obou verzí je výsledek přesnější než z jednoho samotného.

## Jak nahrávku přepsat

1. Uložte nahrávku do sledované složky na Google Disku (odkaz na složku vám poskytne správce, případně jej doplňte sem na wiki).
2. Nic dalšího dělat nemusíte. Skript se spouští automaticky v pravidelných intervalech.
3. Hotový přepis najdete ve výstupní složce jako textový soubor se stejným názvem jako nahrávka a příponou `_final.txt`. Příklad: nahrávka `porada_2026-08-01.m4a` → přepis `porada_2026-08-01_final.txt`.
4. Zpracovaná nahrávka se ve zdrojové složce označí **hvězdičkou** — podle ní poznáte, že je hotovo a soubor se už znovu zpracovávat nebude.

## Jak dlouho to trvá

Skript běží typicky každých 10–15 minut a v jednom běhu zpracuje tolik souborů, kolik stihne. Kratší nahrávka (do 15 minut záznamu) bývá přepsaná do půl hodiny od nahrání. Delší nahrávky nebo více souborů najednou mohou počkat na další běh — to je normální chování, ne chyba.

## Co je potřeba dodržet

**Velikost souboru do 50 MB.** Větší soubory technologie neumí zpracovat a skript je přeskočí. U delších záznamů proto nahrávejte v komprimovaném formátu (MP3 nebo M4A s běžnou kvalitou pro řeč), nikoli nekomprimovaný WAV. Orientačně: hodina záznamu v MP3 128 kb/s má kolem 55 MB, při 64 kb/s kolem 28 MB — pro přepis řeči nižší bitrate bohatě stačí.

**Srozumitelný záznam.** Kvalita přepisu odpovídá kvalitě nahrávky. Mluvte blízko mikrofonu, omezte hluk na pozadí a překřikování více osob.

**Neměňte název souboru po nahrání** a nemažte hvězdičku u zpracovaných souborů — skript by nahrávku zpracoval znovu.

**Čeština.** Služba je nastavená na český jazyk. Nahrávky v jiném jazyce se přepíší hůře; pokud potřebujete jiný jazyk pravidelně, kontaktujte správce.

## Nejčastější situace

**Nahrávka je ve složce déle než hodinu a přepis nikde.** Zkontrolujte velikost souboru (limit 50 MB) a zda soubor nemá hvězdičku (pak už by přepis měl být ve výstupní složce). Pokud je vše v pořádku a přepis stále chybí, kontaktujte správce — v protokolu skriptu dohledá, co se stalo.

**V přepisu jsou chybně zapsaná jména nebo odborné termíny.** Automatické rozpoznávání řeči si s méně běžnými jmény a zkratkami vždy neporadí. Výsledný text berte jako kvalitní pracovní podklad, který u důležitých dokumentů projděte. Přepis nenahrazuje autorizovaný zápis.

**Potřebuji rozlišit, kdo co řekl.** Rozlišování mluvčích je ve výchozím nastavení vypnuté (prodlužuje a prodražuje zpracování). Pokud jej potřebujete, domluvte se se správcem — jde o změnu jednoho parametru v konfiguraci.

**Nahrávku jsem tam dal omylem.** Pokud ještě nemá hvězdičku, stačí ji ze složky smazat nebo přesunout. Pokud už byla zpracovaná, smažte nahrávku i vygenerovaný `_final.txt` z výstupní složky.

## Důvěrnost a ochrana údajů

Nahrávky se při přepisu odesílají externím službám (Soniox, ElevenLabs, Google Gemini). **Nevkládejte do sledované složky nahrávky obsahující zvláštní kategorie osobních údajů ani důvěrné informace, u kterých zpracování externí službou neschválil odpovědný pracovník.** V případě pochybností se před nahráním poraďte se správcem nebo pověřencem pro ochranu osobních údajů.

## Kontakty

| Role | Kdo | Kdy kontaktovat |
|---|---|---|
| Správce služby | *(doplňte)* | Přepis nevzniká, změna nastavení, přístup do složek |
| Pověřenec OOÚ | *(doplňte)* | Dotazy k důvěrnosti nahrávek |

---
*Poslední aktualizace: srpen 2026*
