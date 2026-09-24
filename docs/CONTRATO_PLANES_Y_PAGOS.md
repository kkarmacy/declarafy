# Contrato de planes y activación de pagos

**Nombres comerciales:** Free / Profesional / Empresa.  
**Valores de formulario:** `basico` / `profesional` / `empresa`.  
**Valores internos PHP/MySQL:** `basico` / `pro` / `empresa`.

| Importe de cargo Culqi | Identificador interno | Vigencia |
|---|---|---|
| S/ 190.00 | `pro` | 1 mes |
| S/ 1,900.00 | `pro` | 12 meses |
| S/ 750.00 | `empresa` | 1 mes |
| S/ 7,500.00 | `empresa` | 12 meses |

**Secuencia esperada:** el formulario crea primero una cuenta básica. El usuario inicia el pago en Culqi. Solo el webhook backend, después de consultar a Culqi con la clave privada y verificar el cargo, asigna el plan `pro` o `empresa`. No elevar permisos por retorno del navegador, parámetro de URL ni valor del formulario.

**Antes de habilitar cobros reales:** confirmar los importes de los enlaces vigentes con Culqi, configurar la URL de webhook, enviar un cargo de prueba y comprobar que el email de metadata coincide con el usuario registrado; confirmar idempotencia, activación, vigencia y recibo. En especial, el enlace comercial anual de S/750 debe distinguirse de un plan Empresa mensual de S/750: el backend determina el plan **por importe**, no por enlace. No asumir que una compra de S/750 anual puede activar Empresa por doce meses.

**No se han ejecutado cargos reales ni accedido al panel Culqi en esta auditoría.**
