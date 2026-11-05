# Licence třetích stran

Kromě vlastního kódu obsahuje aplikace Závady vozů tyto cizí součásti. Všechny jsou pod volnými licencemi (MIT, Apache 2.0, MPL 2.0), které dovolují použití i šíření, také komerční. Podmínkou je přiložit text licence a zachovat údaje o autorech, u MPL 2.0 navíc uvést, kde je zdrojový kód – to plní tento soubor a soubory licencí, na které odkazuje. Žádná součást není upravená.

Ověřeno 5. 11. 2026.

## Skener čísla vozu

### PaddleOCR PP-OCRv5 mobile – neuronové sítě

| Soubor | Co to je |
|---|---|
| `models/det.onnx` | PP-OCRv5_mobile_det – najde na fotce řádky textu |
| `models/rec_latin.onnx` | latin_PP-OCRv5_mobile_rec – přečte řádek (latinka včetně české diakritiky) |
| `models/rec_latin_dict.txt` | ppocrv5_latin_dict.txt – znaky, které čtecí síť zná |

- Autor: PaddlePaddle Authors – <https://github.com/PaddlePaddle/PaddleOCR>
- Licence: Apache License 2.0, Copyright (c) 2016 PaddlePaddle Authors. All Rights Reserved. Text licence: [`models/LICENSE`](models/LICENSE).
- Původ: sítě ve formátu ONNX z repozitáře <https://huggingface.co/snowfluke/ppu-paddle-ocr-models> (PT Perkasa Pilar Utama, Apache 2.0; podle jeho README převzaté z <https://www.paddleocr.ai>), soubory `detection/PP-OCRv5_mobile_det_infer.onnx` a `recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx` – beze změny, jen přejmenované. Slovník je beze změny `ppocr/utils/dict/ppocrv5_latin_dict.txt` z repozitáře PaddleOCR.
- Kontrolní součty SHA-256 (shodné se soubory v revizi `bf1d5ed` repozitáře snowfluke a se slovníkem v repozitáři PaddleOCR):
  - `det.onnx` d7fe3ea74652890722c0f4d02458b7261d9f5ae6c92904d05707c9eb155c7924
  - `rec_latin.onnx` 497dbed20b7fd86334c9deb5082c2958982a316bb16e3589ebc6502cd85cae79
  - `rec_latin_dict.txt` ccbcc45730b3fbbd9050c5bc74db6a99067141ef1035e3d14889a84a6b9b1aff

### ONNX Runtime Web 1.20.1 – spouští sítě v telefonu

- Soubory: `vendor/ort/ort.wasm.min.mjs`, `vendor/ort/ort-wasm-simd-threaded.mjs`, `vendor/ort/ort-wasm-simd-threaded.wasm`
- Autor: Microsoft Corporation – <https://github.com/microsoft/onnxruntime>
- Licence: MIT, text licence: [`vendor/ort/LICENSE`](vendor/ort/LICENSE).
- Součásti jiných autorů zabudované do ONNX Runtime: [`vendor/ort/ThirdPartyNotices.txt`](vendor/ort/ThirdPartyNotices.txt) – seznam Microsoftu z repozitáře ONNX Runtime, verze v1.20.1 (platí pro všechna sestavení ONNX Runtime, nejen pro webové).

## Převod videa

### Mediabunny 1.65.2 – `vendor/mediabunny-1.65.2.min.mjs`

Zmenšení videa nad 50 MB a přebalení videa z iPhonu do MP4 (`js/video.js`). Video kóduje sám telefon (WebCodecs) – knihovna žádný kodek neobsahuje.

- Autor: Vanilagy and contributors – <https://github.com/Vanilagy/mediabunny>
- Licence: Mozilla Public License 2.0, text licence: [`vendor/mediabunny-LICENSE.txt`](vendor/mediabunny-LICENSE.txt).
- Soubor je beze změny `dist/bundles/mediabunny.min.mjs` z balíčku npm `mediabunny@1.65.2` (SHA-256 08149edcc8cf980da65d94a0a54a8fc0fa85a65f89b66f55c906f33618363919).
- Zdrojový kód této verze: <https://github.com/Vanilagy/mediabunny/tree/v1.65.2>
- MPL 2.0 platí jen pro soubory knihovny. Kdyby se upravily, musely by se úpravy zveřejnit pod stejnou licencí; zbytek aplikace se jí neřídí.

## Obrazovky a připojení k databázi

### Preact a htm – `vendor/preact-htm.js`

Sestavení `htm/preact/standalone` (Preact 10 + htm 3 v jednom souboru).

- Preact – Jason Miller, licence MIT (text níže) – <https://github.com/preactjs/preact>
- htm – Google Inc., licence Apache License 2.0, Copyright 2018 Google Inc. (text licence stejný jako [`models/LICENSE`](models/LICENSE)) – <https://github.com/developit/htm>

### supabase-js 2.117.2 – `vendor/supabase.js`

- Autor: Supabase, licence MIT (text níže) – <https://github.com/supabase/supabase-js>
- Sestavení obsahuje i další balíčky Supabase (auth-js, postgrest-js, realtime-js, storage-js, functions-js) pod stejnou licencí.

## Data

### Řady vozů – `data/rady.json`

Převod tabulky Evropské agentury pro železnice (ERA) „Assignment of EVN“, Appendix 6, Part 9 (`appendix_6_p9_en.xls`) – zdroj: <https://www.era.europa.eu/domains/registers/evr_en>. Převzato z aplikace Výkaz vozů (`tools/era_rady.py`).

## Texty licencí MIT

### Preact

```
The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### supabase-js

```
MIT License

Copyright (c) 2020 Supabase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

ONNX Runtime: [`vendor/ort/LICENSE`](vendor/ort/LICENSE). Apache License 2.0 (PaddleOCR, htm): [`models/LICENSE`](models/LICENSE). Mozilla Public License 2.0 (Mediabunny): [`vendor/mediabunny-LICENSE.txt`](vendor/mediabunny-LICENSE.txt).
