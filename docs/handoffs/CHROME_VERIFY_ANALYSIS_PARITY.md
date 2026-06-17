# Dataset-lane analysis parity verification (Claude in Chrome)

Verify the new big-table (DuckDB) analyses end to end on http://localhost:3000. The math is already proven by parity tests; this live pass confirms the DuckDB readers and the new dialog column-pickers feed the engine correctly.

IMPORTANT (import path): the native file picker can't be driven and the test machine may not have the fixture folder connected, so DO NOT use "Choose a file". Use the **paste box** (data-testid `datahub-import-paste`) with the CSV below.

## Setup
1. Data Hub -> Import data -> paste the CSV below into the "Paste from Excel or Google Sheets" box and import it. Name it "Parity fixture". It is 48 rows, so it stays in the normal (editable) lane.
2. Click **"Switch to large-dataset mode"** on the table toolbar (the manual switch). EXPECT the explainer card to read **"Large-table mode"** and say "You switched this table into large-table mode ... nothing uploads" (NOT "Large dataset detected", since 48 rows is not large; this also checks a recent fix). Dismiss it ("Got it").
3. Confirm the dataset view with Analyze / Graph / Transform / Export.

Columns: `response, treatment, timepoint, operator, baseline, conc, effect, surv_time, event, arm, sex, outcome, score, label`.

```
response,treatment,timepoint,operator,baseline,conc,effect,surv_time,event,arm,sex,outcome,score,label
29.49,Control,Day1,c1,35.77,17.975,65.05,9.1,1,ArmA,M,Pos,0.765,1
29.3,Control,Day1,c2,34.96,0.028,1.92,1.19,1,ArmB,F,Neg,0.403,0
28.22,Control,Day1,c1,33.17,760.809,97.62,6.84,1,ArmA,M,Pos,0.768,1
30.51,Control,Day1,c2,34.1,8.091,44.01,7.14,1,ArmB,F,Pos,0.611,1
29.11,Control,Day1,c1,32.64,0.372,6.34,7.13,0,ArmA,M,Pos,0.632,1
27.82,Control,Day1,c2,32.81,237.513,91.15,35.29,1,ArmB,F,Neg,0.202,0
31.34,Control,Day1,c1,37.56,0.016,3.47,17.02,0,ArmA,M,Pos,0.122,0
27.82,Control,Day1,c2,32.44,1.91,22.01,5.78,1,ArmB,F,Pos,0.056,0
30.2,Control,Day2,c1,30.06,128.713,88.09,22.09,1,ArmA,M,Pos,0.816,1
34.52,Control,Day2,c2,37.73,69.369,84.7,4.46,0,ArmB,F,Pos,0.766,1
30.05,Control,Day2,c1,33.76,124.853,89.39,10.73,1,ArmA,M,Neg,0.227,0
34.73,Control,Day2,c2,38.38,0.144,6.52,8.01,1,ArmB,F,Pos,0.837,1
32.24,Control,Day2,c1,38.01,582.76,92.6,19.23,0,ArmA,M,Pos,0.166,0
34.76,Control,Day2,c2,33.38,97.581,85.06,0.98,1,ArmB,F,Pos,0.776,1
34.3,Control,Day2,c1,38.3,0.501,9.33,3.28,1,ArmA,M,Pos,0.701,1
35.94,Control,Day2,c2,36.01,0.055,5.47,4.08,1,ArmB,F,Neg,0.411,0
35.75,DrugA,Day1,a1,38.36,0.027,6.71,6.15,0,ArmA,M,Pos,0.766,1
40.34,DrugA,Day1,a2,39.43,0.054,5.03,6.76,0,ArmB,F,Neg,0.292,0
37.87,DrugA,Day1,a1,40.84,0.068,5.95,30.2,1,ArmA,M,Pos,0.153,0
41.9,DrugA,Day1,a2,40.58,107.249,88.69,2.31,1,ArmB,F,Neg,0.521,1
39.59,DrugA,Day1,a1,40.08,0.198,4.98,11.86,0,ArmA,M,Neg,0.019,0
37.07,DrugA,Day1,a2,39.6,0.136,6.65,8.81,0,ArmB,F,Neg,0.777,1
35.95,DrugA,Day1,a1,35.03,0.027,2.91,30.49,0,ArmA,M,Pos,0.477,1
38.44,DrugA,Day1,a2,37.48,100.953,88.86,4.62,0,ArmB,F,Neg,0.679,1
42.8,DrugA,Day2,a1,42.22,334.396,92.78,35.03,0,ArmA,M,Pos,0.637,1
40.99,DrugA,Day2,a2,40.18,0.012,7.96,6.73,0,ArmB,F,Neg,0.268,0
42.63,DrugA,Day2,a1,40.09,0.182,6.21,17.66,1,ArmA,M,Pos,0.786,1
43.58,DrugA,Day2,a2,40.79,1.953,15.95,4.91,0,ArmB,F,Neg,0.17,0
41.62,DrugA,Day2,a1,40.75,1.587,17.4,32.11,1,ArmA,M,Pos,0.31,0
40.33,DrugA,Day2,a2,39.55,3.906,26.99,1.01,1,ArmB,F,Pos,0.628,1
42.33,DrugA,Day2,a1,38.81,6.436,40.52,11.71,0,ArmA,M,Pos,0.036,0
41.23,DrugA,Day2,a2,38.56,4.639,28.8,10.81,0,ArmB,F,Neg,0.739,1
41.54,DrugB,Day1,b1,39.02,158.489,90.32,11.67,1,ArmA,M,Pos,0.746,1
44.3,DrugB,Day1,b2,39.09,305.585,93.94,9.72,1,ArmB,F,Neg,0.457,0
46.94,DrugB,Day1,b1,48.32,0.98,6.99,35.73,1,ArmA,M,Pos,0.329,0
45.3,DrugB,Day1,b2,43.77,0.391,8.32,7.27,1,ArmB,F,Pos,0.677,1
44.29,DrugB,Day1,b1,40.46,0.021,8.7,71.3,1,ArmA,M,Pos,0.68,1
46.29,DrugB,Day1,b2,41.58,0.044,1.51,15.38,1,ArmB,F,Pos,0.424,0
43.2,DrugB,Day1,b1,40.27,0.028,8.11,11.08,1,ArmA,M,Neg,0.365,0
46.27,DrugB,Day1,b2,42.34,191.048,94.17,5.44,1,ArmB,F,Neg,0.397,0
49.88,DrugB,Day2,b1,45.99,4.311,32.18,3.52,1,ArmA,M,Pos,0.758,1
48.86,DrugB,Day2,b2,47.61,0.282,6.22,3.84,1,ArmB,F,Pos,0.7,1
49.73,DrugB,Day2,b1,42.35,0.089,1.18,2.25,0,ArmA,M,Pos,0.744,1
51.01,DrugB,Day2,b2,43.78,3.415,25.74,3.78,0,ArmB,F,Neg,0,0
48.47,DrugB,Day2,b1,45.28,0.019,5.7,27.01,1,ArmA,M,Pos,0.733,1
52.19,DrugB,Day2,b2,42.7,22.528,67.03,3.12,1,ArmB,F,Pos,0.788,1
49.58,DrugB,Day2,b1,49.88,729.651,92.35,67.43,1,ArmA,M,Pos,0.674,1
48.33,DrugB,Day2,b2,45.7,3.265,27.87,0.5,1,ArmB,F,Pos,0.836,1
```

## Part A - XY analyses (Analyze, wide mode; picker should read X / Y)
1. **Linear regression** - X `response`, Y `baseline`. EXPECT slope approx 0.5, r approx 0.89, n=48.
2. **Dose-response** - X `conc`, Y `effect`. EXPECT a 4PL fit, EC50 approx 10, top approx 95, bottom approx 5.
3. **Logistic regression** - X `score`, Y `label`. EXPECT a positive slope (score 0.72 for label 1 vs 0.24 for label 0), p small.
4. **ROC curve** - X `score`, Y `label`. EXPECT AUC clearly above 0.5 (roughly 0.9).

## Part B - whole-table analyses (each reveals its own role pickers)
5. **Two-way ANOVA** - Value `response`, Row factor `treatment`, Column factor `timepoint`. EXPECT a strong treatment effect (means Control approx 31.3, DrugA approx 40.2, DrugB approx 47.3) and a Day2-higher timepoint effect (~+4).
6. **Contingency** - Row factor `sex`, Column factor `outcome`. EXPECT a 2x2 with a significant association. Counts: M = Pos 21 / Neg 3; F = Pos 11 / Neg 13. Should also report Fisher + odds ratio.
7. **Kaplan-Meier** - Time `surv_time`, Event `event`, Group `arm`. EXPECT two curves read from the two arms; ArmB has shorter survival times. (n is small, so just confirm it runs on 2 arms and reports a median + log-rank, not necessarily a tiny p.)
8. **Cox regression** - Time `surv_time`, Event `event`, Group `arm`. EXPECT a hazard ratio for ArmB vs ArmA and a result (direction: ArmB worse). Confirms it runs on the two arms.
9. **Nested one-way ANOVA** - Value `response`, Group `treatment`, Subgroup `operator`. EXPECT 3 groups each with its operator subgroups, a significant group effect.
10. **Nested t-test** - Value `response`, Group `timepoint`, Subgroup `operator`. EXPECT it runs on the 2 timepoint groups (plumbing check for the value/group/subgroup picker).

## Report
Per analysis (1-10): PASS / FAIL, the picker labels you saw, the key numbers it reported (slope/r, EC50, AUC, F/p, chi-square/p, log-rank p, hazard ratio), any console error verbatim, and a screenshot. Call out specifically: (setup) the manual-switch card reads "Large-table mode" not "Large dataset detected"; (A) the XY picker shows X/Y; (B) each whole-table analysis shows its own role dropdowns (Value/Row factor/Column factor; Time/Event/Group; Value/Group/Subgroup); (C) the group structures read correctly (3 treatment levels, the 2x2 counts above, 2 survival arms). Do not change any sharing or permission settings.
