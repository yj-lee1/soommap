# Offline fixture

`seoul-population.json` is a trimmed public response from Seoul's citydata_ppltn API, captured on 2026-09-17 for 여의도한강공원. The source observation time is 14:40 KST. It is **test data**, never a fallback for the live service. Tests create malformed/expired variants in memory. No API key or demographic fields are included.

Source: 서울특별시, https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do (공공누리 제1유형). `npm test` uses fixed clocks and injected fetch mocks, and does not call either external API.
