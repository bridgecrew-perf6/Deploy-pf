const { User, Establishment, Site, Court, Booking, Op } = require("../db");
const axios = require('axios')
const { TUCANCHAYAMAIL, TUCANCHAYAMAILPASS } = process.env;
const ical = require("ical-generator")
const nodemailer = require("nodemailer");
const { DB_HOST } = process.env;
const { randomString, minutesToHour, formatBookingsEst } = require("./utils/utils");


async function sender(userEmail, contentHTML, booking) {
  console.log(userEmail, booking);
  const courtInfo = await Court.findOne({
    where: { id: booking.courtId },
    include: { model: Site },
  });
  let transporter = nodemailer.createTransport({
    host: "smtp.mailgun.org",
    port: 587,
    secure: false, // sin SSL
    auth: {
      user: TUCANCHAYAMAIL, // generated ethereal user
      pass: TUCANCHAYAMAILPASS, // generated ethereal password
    },
  });

  const calendar = ical({ name: "Tu cancha Ya - Calendar" });
  calendar.createEvent({
    start: booking.startTime ,
    end: booking.endTime,
    summary: `Reserva de cancha ${courtInfo.sport}`,
    description: `${courtInfo.sport}`,
    location: {
      title: ' ',
      address:`${courtInfo.site.street} ${courtInfo.site.streetNumber.toString()} , ${courtInfo.site.city}`,
      geo:{lat: parseFloat(courtInfo.site.latitude), lon: parseFloat(courtInfo.site.longitude)}
    },
    organizer: {
      email: 'tucanchaya@noresponse.com',
      name:"Tu cancha YA!"}
  });
  const response = await transporter.sendMail({
    from: "'Tu Cancha YA!' <tucanchaya@noresponse.com>",
    to: userEmail,
    subject: "Codigo de reserva",
    html: contentHTML,
    icalEvent: {
      filename: "reservaCancha.ics",
      method: "request",
      content: calendar.toString(),
    },
  });
}


const getAllBookings = async (req, res, next) => {
  try {
    const all = await Booking.findAll();

    res.status(200).json(all);
  } catch (e) {
    next(e);
  }
};

const newBooking = async (req, res, next) => {

  const { data } = req.body
  console.log(req.body);

  try {
    const payData = await axios.get(`https://api.mercadopago.com/v1/payments/${data.id}/?access_token=TEST-8344826949636961-021621-fa6f50dd49774c61c2de981dba9fbeae-157434994`)
    const [external_reference, userId] = payData.data.external_reference.split('-')
    const [year, month, day,hour] = payData.data.additional_info.items[0].description.split(',')
    const userData = await User.findOne({ where: { id: parseInt(userId) } });
    if (payData.data.status_detail === "accredited") {
      let contentHTML = `
          <h3>Hola, ${userData.name}!</h3>
          <p> Gracias por usar nuestro servicio de reservas. Acercate con tu codigo de reserva a la cancha</p>
          <h2>&#9917; ${external_reference} &#9917;</h2>
          `;
      let booking = {
        userId: userData.id,
        courtId : parseInt(payData.data.additional_info.items[0].id),
        price : parseInt(payData.data.additional_info.items[0].unit_price),
        startTime : new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour)),
        endTime : new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour) + 1),
        payment_id : payData.data.id,
        payment_status : payData.data.status_detail,
        external_reference : external_reference,
        merchant_order_id : payData.data.order.id,
        finalAmount: parseInt(payData.data.additional_info.items[0].unit_price),
        status: 'completed'
      }
      const existent = await Booking.findOne({
        where:{payment_id : payData.data.id}
      })
      console.log('HOLA SOY EXISTENT', existent);
      if(!existent){
        console.log('entre al if');
      const sendMail = await sender(userData.email, contentHTML, booking)
      console.log(sendMail);
      Booking.create(booking)
        .then((response) => {
          console.log("redirect success");
          return res.redirect(`http://localhost:3000/profile`);
        })
        .catch((err) => {
          console.log("error al buscar", err);
          return res.redirect(`http://localhost:3000/payment`);
        });
      }else{
        res.status(200).send('Booking ok')
      }
    }
  } catch (error) {
    res.status(404).send(error)
  }
}


//   /*
//      ESTO ES IMPORTANTE PARA CREAR BIEN LA RESERVA CON EL FORMATO DATE EN LA BASE DE DATOS
//      posiblemente les haya funcionado porque el string que tienen se los pase como debe ser pero no esta bueno mandarle asi y aca los meses se enumeran distinto es una cosa loca lo que van a tener que hacer es lo que sigue:

//   CUANDO RECIBAN EL OBJETO QUE MANDA EL FRONT CON year, month, date, y startTime hay que separar si o si el estar time en hora y minutos con un split y crear la fecha asi:

//   let startTime = new Date (year, month, date, hour, minute, 00)

//   agreguen los ceros que son re importantes para la comparación de si hay canchas disponibles
//   lo mismo para el endTime si les falla manden mensaje y vemos que onda eso si o si tiene que ser en el backend porque el servidor es el que hace eso

//      */

//this code needs reviewing and modularizing (i know ill get to it when i get to it)
const getCourtAvailability = async (req, res, next) => {
  try {
    //     buscar el horarios apertura y cierre del establecimiento
    const courtId = req.params.id;
    const dateToCheck = req.query.date;
    const infoCourt = await Court.findOne({
      where: { id: courtId },
      include: [
        {
          model: Site,
          as: "site",
          attributes: ["id", "street", "streetNumber"],
          include: {
            model: Establishment,
            as: "establishment",
            attributes: ["timeActiveFrom", "timeActiveTo"],
          },
        },
      ],
    });

    let [activeFromHour, activeFromMin] =
      infoCourt.site.establishment.timeActiveFrom.split(":");
    let [activeToHour, activeToMin] =
      infoCourt.site.establishment.timeActiveTo.split(":");

    //calculo el largo del dia de trabajo en minutos de inicio y de fin
    activeTo = parseInt(activeToHour) * 60 + parseInt(activeToMin);
    activeFrom = parseInt(activeFromHour) * 60 - parseInt(activeFromMin);
    console.log(activeTo, "activeto");
    //     la duración del dia de trabajo del court en minutos
    let businessHoursInMinutes = activeTo - activeFrom;
    //     dividir las horas abiertas por la duración de los turno y me da cuantos slots son
    //2022-02-12 con esta fecha traer las reservas de esa cancha
    //traer el el dia completo de reservas de esa cancha
    let [year, month, day] = dateToCheck.split("-");
    let searchFromDate = new Date(year, month - 1, day);
    let searchToDate = new Date(year, month - 1, day, 23, 59);
    console.log(searchFromDate, searchToDate);
    const dayBookings = await Booking.findAll({
      where: {
        [Op.and]: [
          {
            courtId: infoCourt.id,
          },
          {
            startTime: {
              [Op.between]: [searchFromDate, searchToDate],
            },
          },
        ],
      },
    });
    console.log("reservas del dia", dayBookings);
    let slotsQuantity = businessHoursInMinutes / infoCourt.shiftLength;
    console.log("cantidad de turnos en el dia", slotsQuantity);
    let availability = [];

    // console.log(dayBookings)
    for (let i = 0; i < slotsQuantity; i++) {
      let startSlotMin = activeFrom + i * infoCourt.shiftLength;
      let endSlotMin = startSlotMin + infoCourt.shiftLength;

      let start = minutesToHour(startSlotMin);
      let end = minutesToHour(endSlotMin);
      let [stHour, stMin] = start.split(":");

      let compareDate = new Date(year, month - 1, day, stHour, stMin, 00);
      //console.log('comparo aca', (compareDate.getTime()) === dayBookings[0].startTime.getTime())

      let available = dayBookings.filter(
        (el) => el.startTime.getTime() === compareDate.getTime()
      );
      //calcular inicio fin crear fecha ver si esta disponible y  pushear el objeto con las 3 cosas
      // slots.push({})
      let isAvailable = available.length ? false : true;
      availability.push({
        date: {
          year,
          month,
          day,
        },
        startTime: start,
        endTime: end,
        isAvailable: isAvailable,
      });
    }

    res.status(200).json([availability]);
  } catch (e) {
    next(e);
  }
};


const getBookingsByEstId = async (req, res) => {
  var dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom):null;
  var dateTo = req.query.dateTo ? new Date(req.query.dateTo):null;
  var estId = req.params.estId;

  const bookings = await Booking.findAll({
    include:[{
      model: Court,
      attributes: [
        'id',
        'name',
        'price',
        'sport'
      ],
      include: {
        model: Site,
        attributes: [
          'name',
        ],
        include: {
          model: Establishment,
          as: 'establishment',
          attributes: [
            'name',
          ]
        },
      }
    },
    {
      model: User,
      attributes: [
        'name',
        'lastName'
      ]
    }
    ],
    where: {
      [Op.and]: [
        {'$court->site.establishmentId$': estId},
        {'$booking.startTime$': {[Op.gte]: dateFrom}},
        {'$booking.endTime$': {[Op.lte]: dateTo}},
      ]
    },
    attributes: [
      'id', 
      'details', 
      'startTime', 
      'endTime', 
      'payment_id',
      'payment_status',
      'external_reference'
    ]
  })
  let results = formatBookingsEst(bookings)
  res.send(results)
}


const getBookingsByEstablishment = async (req,res)=>{
  var dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom):null;
  var dateTo = req.query.dateTo ? new Date(req.query.dateTo):null;
  var siteId = req.query.siteId;
  var sport = req.query.sport;
  const establishmentId = req.params.establishmentId;

  console.log('dateFrom',dateFrom);
  console.log('dateTo',dateTo);

  const bookings = await Booking.findAll({
    include: [
      {
        model: Court,
        as: "court",
        include: {
          model: Site,
          as: "site",
          include: {
            model: Establishment,
            as: "establishment",
          },
        },
      },
      {
        model: User,
        as: "user",
      },
    ],
    where: {
      [Op.and]: [
        {userId: {[Op.gte]:2}},
        { "$court.site.establishmentId$": establishmentId },
        siteId ? { "$court.site.id$": siteId } : null,
        dateFrom ? { startTime: { [Op.gte]: dateFrom } } : null,
        dateTo ? { startTime: { [Op.lte]: dateTo } } : null,
        sport ? { "$court.sport$": sport } : null,
      ],
    },
  });

  let sortedBookings = await bookings.sort(function (c, d) {
    if (c.startTime < d.startTime) {
      return 1;
    }
    if (c.startTime > d.startTime) {
      return -1;
    }
    return 0;
  });

  let mapingBookings = await sortedBookings.map((b) => {
    return {
      external_reference: b.external_reference,
      day: b.startTime,
      siteName: b.court.site.name,
      courtName: b.court.name,
      sport: b.court.sport,
      finalAmount: b.finalAmount,
    };
  });

  res.send(mapingBookings);
};

async function emailSender(userId, code) {
  const userData = await User.findOne({ where: { id: userId } });

  let contentHTML = `
  <h3>Hola, ${userData.name}!</h3>

  <p> Gracias por usar nuestro servicio de reservas. Acercate con tu codigo de reserva a la cancha</p>
  <h2>&#9917; ${code} &#9917;</h2> `;
  let transporter = nodemailer.createTransport({
    host: "smtp.mailgun.org",
    port: 587,
    secure: false, // sin SSL
    auth: {
      user: TUCANCHAYAMAIL, // generated ethereal user
      pass: TUCANCHAYAMAILPASS, // generated ethereal password
    },
  });

  const response = await transporter.sendMail({
    from: "'Tu Cancha YA!' <tucanchaya@noresponse.com>",
    to: `${userData.email}`,
    subject: "Codigo de reserva",
    html: contentHTML,
  });

  console.log(response);
}

const courtBookings = async (req, res, next) => {
  const { courtId } = req.params;
  try {
    const courtBooking = await Court.findAll({
      where: { id: courtId },
    });

    res.send(courtBooking);
  } catch (error) {
    next(error);
  }
};


const addBooking = async (req, res, next) => {
  const { courtId, details, dateFrom, dateTo, finalAmount } = req.body;
  let external_reference = randomString(8)
  // ES IMPORTANTE VER COMO ME MANDAN LA FECHA ACA ASI LA GUARDI DIRECTO O LA CONVIERTO A FORMATO FECHA COMO LE QUEDE MAS COMODO AL DAN EN EL FRONT
  try {
    const newBooking = await Booking.create({
      courtId,
      userId : 1,
      details, 
      status: 'approved',
      startTime: dateFrom,
      endTime: dateTo,
      external_reference,
      finalAmount
    });

    res.send(newBooking.external_reference);

  } catch (error) {
    next(error);
  }
};


module.exports = {
  getAllBookings,
  newBooking,
  getCourtAvailability,
  getBookingsByEstablishment,
  getBookingsByEstId,
  courtBookings,
  addBooking
};
