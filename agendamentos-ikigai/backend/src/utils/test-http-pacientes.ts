async function testApi() {
  console.log("Chamando a API POST /api/pacientes...");
  const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
  const testCpf = `999.888.${randomSuffix.slice(0, 3)}-${randomSuffix.slice(3, 4)}5`;
  const testPhone = `(11) 9${randomSuffix}-9999`;

  try {
    const res = await fetch("http://localhost:3000/api/pacientes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nome_completo: "Teste Dynamic Paciente",
        cpf: testCpf,
        telefone: testPhone,
        endereco: "Av. Paulista, 1000"
      })
    });

    console.log("Status da resposta:", res.status);
    const text = await res.text();
    console.log("Corpo da resposta:", text);
  } catch (err: any) {
    console.error("Erro na requisição:", err.message);
  }
}

testApi();
