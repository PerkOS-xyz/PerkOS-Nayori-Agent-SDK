# Diseño de promoción SDK mainnet v6/v5

## Objetivo y límite

La siguiente versión menor del SDK cambia únicamente los contratos de comercio predeterminados
de **Stacks mainnet** a `agentic-commerce-v6` y `sbtc-commerce-v5`. Los defaults genéricos de
testnet permanecen en v5/v4 y las rutas QA continúan fijando explícitamente v6/v5. El registro de
agentes, reputación y token sBTC canónico no cambian. Los jobs históricos no se migran: quien deba
leerlos o liquidarlos conserva v5/v4 mediante overrides explícitos.

El cambio se publica como `0.9.0`, no como patch de `0.8.0`, porque modifica la economía y el
comportamiento observable de un cliente mainnet sin overrides. En v6/v5 el presupuesto es bruto,
el fee potencial incluido es 200 bps y tanto cliente como proveedor deben aceptar los términos
antes de financiar o entregar. `completeJob` y `rejectJob` siguen disponibles para generaciones
anteriores; v6/v5 usa decisión explicable, apelación y liquidación final.

## x402 y seguridad

El requirement x402 de escrow vincula cuatro campos: presupuesto bruto, 200 bps, treasury y
reembolso neto después de evaluación. Un contrato v6/v5 rechaza requirements que omitan o alteren
estos campos. El payer también debe proporcionar un callback de aceptación que devuelva
estrictamente `true`; sin callback, con rechazo o con error, no se consulta al signer ni se financia.
Después de esa aceptación, `PerkOSClient.fundJob` vuelve a contrastar job, presupuesto, treasury y
estado live antes de permitir la firma. Para contratos sin fee, la presencia de términos de fee
también falla cerrada.

El ejemplo histórico del facilitador conserva su transacción v4 mediante un override explícito.
No se reetiqueta evidencia antigua como v5. El x402 directo y MPP no dependen de estos defaults.

## Verificación

Las regresiones prueban los mapas exactos por red, el aislamiento QA/testnet, consentimiento y
tamper de x402, 98/2 para STX y sBTC, rechazo antes del signer, compatibilidad v5/v4 mediante
override, serialización y documentación/versionado. El gate final incluye Node 20/22, build,
tests, `npm pack --dry-run --json` e instalación limpia del tarball. Este cambio no publica npm,
no despliega contratos y no transmite transacciones.
